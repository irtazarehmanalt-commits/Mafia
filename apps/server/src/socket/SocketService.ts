import {
  CLIENT_EVENTS,
  ERROR_MESSAGES,
  GameError,
  SERVER_EVENTS,
  chatSchema,
  emptySchema,
  isGameError,
  joinRoomSocketSchema,
  kickSchema,
  nightActionSchema,
  pingSchema,
  rematchSchema,
  setReadySchema,
  transferHostSchema,
  updateSettingsSchema,
  voteSchema,
  type Ack,
  type ClientToServerEvents,
  type ErrorPayload,
  type ServerToClientEvents,
  type SocketData,
} from '@mafia/shared';
import type { Server, Socket } from 'socket.io';
import type { ZodSchema } from 'zod';

import { verifyToken } from '../auth/tokens';
import { logger } from '../config/logger';
import type { RoomManager } from '../rooms/RoomManager';
import { playerRoom, type RoomRuntime } from '../rooms/RoomRuntime';
import { RateLimiter, SOCKET_RATE_FALLBACK, SOCKET_RATE_RULES } from '../utils/rateLimit';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function errorPayload(err: unknown): ErrorPayload {
  if (isGameError(err)) return err.toPayload();
  return { code: 'INTERNAL_ERROR', message: ERROR_MESSAGES.INTERNAL_ERROR };
}

export function registerSocketHandlers(io: IO, manager: RoomManager): void {
  const limiter = new RateLimiter(SOCKET_RATE_RULES, SOCKET_RATE_FALLBACK);

  io.on('connection', (socket: GameSocket) => {
    logger.debug({ socketId: socket.id }, 'Socket connected');

    /**
     * Wraps every handler with the same guarantees: rate limiting, schema
     * validation, membership checks and error redaction. A handler body can
     * therefore assume it has been given a legitimate, authorised request.
     */
    function bind<TPayload, TResult>(
      event: string,
      schema: ZodSchema<TPayload>,
      handler: (ctx: HandlerContext, payload: TPayload) => Promise<TResult> | TResult,
      options: { requireAuth?: boolean } = {},
    ) {
      const requireAuth = options.requireAuth !== false;

      return async (rawPayload: unknown, ack?: Ack<TResult>) => {
        const respond = (response: Parameters<Ack<TResult>>[0]) => {
          if (typeof ack === 'function') ack(response);
          else if (!response.ok) socket.emit(SERVER_EVENTS.ERROR, response.error);
        };

        try {
          const limiterKey = socket.data.playerId ?? socket.id;
          if (!limiter.consume(limiterKey, event)) {
            throw new GameError('RATE_LIMITED', 429);
          }

          const parsed = schema.safeParse(rawPayload ?? {});
          if (!parsed.success) throw new GameError('VALIDATION_FAILED', 400);

          let ctx: HandlerContext;
          if (requireAuth) {
            const { playerId, roomCode } = socket.data;
            if (!playerId || !roomCode) throw new GameError('NOT_AUTHENTICATED', 401);

            const runtime = manager.peek(roomCode);
            if (!runtime) throw new GameError('ROOM_NOT_FOUND', 404);

            // Membership is re-checked on every single call — holding a token
            // is not the same as still having a seat.
            if (!runtime.state.players.some((p) => p.id === playerId)) {
              throw new GameError('NOT_IN_ROOM', 403);
            }
            ctx = { socket, playerId, roomCode, runtime };
          } else {
            ctx = { socket, playerId: '', roomCode: '', runtime: null as never };
          }

          const data = await handler(ctx, parsed.data);
          respond({ ok: true, data });
        } catch (err) {
          if (!isGameError(err)) {
            logger.error({ err, event, socketId: socket.id }, 'Unhandled socket error');
          }
          respond({ ok: false, error: errorPayload(err) });
        }
      };
    }

    // -----------------------------------------------------------------------
    // Joining — the only handler that runs before authentication
    // -----------------------------------------------------------------------

    socket.on(
      CLIENT_EVENTS.ROOM_JOIN,
      bind(
        CLIENT_EVENTS.ROOM_JOIN,
        joinRoomSocketSchema,
        async (_ctx, payload) => {
          // The token is bound to this specific room; a token for another room
          // is rejected outright.
          const claims = verifyToken(payload.token, payload.roomCode);

          const runtime = await manager.getRuntime(payload.roomCode);
          if (!runtime) throw new GameError('ROOM_NOT_FOUND', 404);
          if (runtime.isClosed()) throw new GameError('ROOM_CLOSED', 410);

          socket.data.playerId = claims.sub;
          socket.data.roomCode = payload.roomCode;
          socket.data.displayName = claims.name;

          // Two rooms per socket: the shared game room for broadcasts, and a
          // private room used for anything only this player may see.
          await socket.join(payload.roomCode);
          await socket.join(playerRoom(claims.sub));

          // Claims the seat, or reconnects to an existing one.
          runtime.run((engine) => engine.addPlayer({ id: claims.sub, name: claims.name }));
          runtime.registerSocket(claims.sub);
          // The name is now held by a real seat, so release the reservation.
          manager.confirmJoin(payload.roomCode, claims.sub);

          return runtime.projectFor(claims.sub);
        },
        { requireAuth: false },
      ),
    );

    // -----------------------------------------------------------------------
    // Room management
    // -----------------------------------------------------------------------

    socket.on(
      CLIENT_EVENTS.ROOM_LEAVE,
      bind(CLIENT_EVENTS.ROOM_LEAVE, emptySchema, ({ runtime, playerId, roomCode }) => {
        runtime.run((engine) => engine.removePlayer(playerId));
        runtime.unregisterSocket(playerId);
        void socket.leave(roomCode);
        void socket.leave(playerRoom(playerId));
        socket.data.roomCode = '';
        socket.data.playerId = '';
      }),
    );

    socket.on(
      CLIENT_EVENTS.ROOM_SET_READY,
      bind(CLIENT_EVENTS.ROOM_SET_READY, setReadySchema, ({ runtime, playerId }, payload) => {
        runtime.run((engine) => engine.setReady(playerId, payload.ready));
      }),
    );

    socket.on(
      CLIENT_EVENTS.ROOM_UPDATE_SETTINGS,
      bind(
        CLIENT_EVENTS.ROOM_UPDATE_SETTINGS,
        updateSettingsSchema,
        ({ runtime, playerId }, payload) => {
          runtime.run((engine) => engine.updateSettings(playerId, payload.settings));
        },
      ),
    );

    socket.on(
      CLIENT_EVENTS.ROOM_KICK,
      bind(CLIENT_EVENTS.ROOM_KICK, kickSchema, ({ runtime, playerId }, payload) => {
        io.to(playerRoom(payload.playerId)).emit(SERVER_EVENTS.ROOM_KICKED, {
          reason: 'The host removed you from this room.',
        });
        runtime.run((engine) => engine.kick(playerId, payload.playerId));
      }),
    );

    socket.on(
      CLIENT_EVENTS.ROOM_TRANSFER_HOST,
      bind(CLIENT_EVENTS.ROOM_TRANSFER_HOST, transferHostSchema, ({ runtime, playerId }, payload) => {
        runtime.run((engine) => engine.transferHost(playerId, payload.playerId));
      }),
    );

    socket.on(
      CLIENT_EVENTS.ROOM_CANCEL,
      bind(CLIENT_EVENTS.ROOM_CANCEL, emptySchema, ({ runtime, playerId }) => {
        runtime.run((engine) => engine.cancelRoom(playerId));
      }),
    );

    // -----------------------------------------------------------------------
    // Gameplay
    // -----------------------------------------------------------------------

    socket.on(
      CLIENT_EVENTS.GAME_START,
      bind(CLIENT_EVENTS.GAME_START, emptySchema, ({ runtime, playerId }) => {
        runtime.run((engine) => engine.startGame(playerId));
      }),
    );

    socket.on(
      CLIENT_EVENTS.GAME_ACTION,
      bind(CLIENT_EVENTS.GAME_ACTION, nightActionSchema, ({ runtime, playerId }, payload) => {
        // The engine re-derives the actor's role from server state; nothing in
        // this payload can assert who the caller is.
        runtime.run((engine) =>
          engine.submitNightAction(playerId, payload.action, payload.targetId),
        );
      }),
    );

    socket.on(
      CLIENT_EVENTS.GAME_VOTE,
      bind(CLIENT_EVENTS.GAME_VOTE, voteSchema, ({ runtime, playerId }, payload) => {
        runtime.run((engine) => engine.castVote(playerId, payload.targetId));
      }),
    );

    socket.on(
      CLIENT_EVENTS.GAME_CHAT,
      bind(CLIENT_EVENTS.GAME_CHAT, chatSchema, ({ runtime, playerId }, payload) => {
        runtime.run((engine) => engine.postChat(playerId, payload.channel, payload.body));
      }),
    );

    socket.on(
      CLIENT_EVENTS.GAME_REMATCH,
      bind(CLIENT_EVENTS.GAME_REMATCH, rematchSchema, ({ runtime, playerId }, payload) => {
        runtime.run((engine) => engine.voteRematch(playerId, payload.vote));
      }),
    );

    socket.on(
      CLIENT_EVENTS.GAME_END_EARLY,
      bind(CLIENT_EVENTS.GAME_END_EARLY, emptySchema, ({ runtime, playerId }) => {
        runtime.run((engine) => engine.endGameEarly(playerId));
      }),
    );

    // Clock synchronisation: lets the client estimate its offset from server
    // time so countdowns stay accurate without trusting the local clock.
    socket.on(
      CLIENT_EVENTS.PING,
      bind(
        CLIENT_EVENTS.PING,
        pingSchema,
        (_ctx, payload) => ({ t: payload.t, serverTime: Date.now() }),
        { requireAuth: false },
      ),
    );

    // -----------------------------------------------------------------------

    socket.on('disconnect', (reason) => {
      const { playerId, roomCode } = socket.data;
      logger.debug({ socketId: socket.id, reason }, 'Socket disconnected');
      limiter.forget(socket.id);
      if (!playerId || !roomCode) return;

      const runtime: RoomRuntime | null = manager.peek(roomCode);
      runtime?.unregisterSocket(playerId);
    });
  });
}

interface HandlerContext {
  socket: GameSocket;
  playerId: string;
  roomCode: string;
  runtime: RoomRuntime;
}
