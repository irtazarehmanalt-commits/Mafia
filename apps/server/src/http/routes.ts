import {
  ERROR_MESSAGES,
  GameError,
  createRoomBodySchema,
  isGameError,
  joinRoomBodySchema,
  roomCodeSchema,
} from '@mafia/shared';
import { Router, type Request, type Response } from 'express';

import { logger } from '../config/logger';
import type { RoomManager } from '../rooms/RoomManager';

/**
 * A deliberately small REST surface. It exists to do the two things that must
 * happen before a WebSocket is useful — create a room and mint a session token
 * — plus a public lookup so the join page can show a room preview.
 * Everything else is a socket event.
 */
export function createRouter(manager: RoomManager): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime(), ...manager.stats() });
  });

  router.post('/rooms', async (req: Request, res: Response) => {
    try {
      const body = createRoomBodySchema.parse(req.body);
      const ticket = await manager.createRoom({
        displayName: body.displayName,
        roomName: body.roomName,
        settings: body.settings,
      });
      res.status(201).json(ticket);
    } catch (err) {
      sendError(res, err, 'createRoom');
    }
  });

  /** Public preview — never exposes roles, votes or any in-game secret. */
  router.get('/rooms/:code', async (req: Request, res: Response) => {
    try {
      const code = roomCodeSchema.parse(req.params.code);
      const runtime = await manager.getRuntime(code);
      if (!runtime || runtime.isClosed()) throw new GameError('ROOM_NOT_FOUND', 404);

      const state = runtime.state;
      const seated = state.players.filter((p) => !p.isSpectator);

      res.json({
        roomCode: state.roomCode,
        roomName: state.roomName,
        status: state.status,
        phase: state.phase,
        playerCount: seated.length,
        maxPlayers: state.settings.maxPlayers,
        minPlayers: state.settings.minPlayers,
        allowSpectators: state.settings.allowSpectators,
        inProgress: state.phase !== 'LOBBY',
        players: seated.map((p) => ({ name: p.name, connected: p.connected })),
      });
    } catch (err) {
      sendError(res, err, 'getRoom');
    }
  });

  router.post('/rooms/:code/join', async (req: Request, res: Response) => {
    try {
      const code = roomCodeSchema.parse(req.params.code);
      const body = joinRoomBodySchema.parse(req.body);
      const ticket = await manager.prepareJoin({
        roomCode: code,
        displayName: body.displayName,
        token: body.token,
        asSpectator: body.asSpectator,
      });
      res.json(ticket);
    } catch (err) {
      sendError(res, err, 'joinRoom');
    }
  });

  return router;
}

/**
 * Maps anything thrown into a safe, stable shape. Raw errors — including Zod's
 * — never reach the browser.
 */
function sendError(res: Response, err: unknown, context: string): void {
  if (isGameError(err)) {
    res.status(err.httpStatus).json(err.toPayload());
    return;
  }

  if (err instanceof Error && err.name === 'ZodError') {
    res.status(400).json({ code: 'VALIDATION_FAILED', message: ERROR_MESSAGES.VALIDATION_FAILED });
    return;
  }

  logger.error({ err, context }, 'Unhandled HTTP error');
  res.status(500).json({ code: 'INTERNAL_ERROR', message: ERROR_MESSAGES.INTERNAL_ERROR });
}
