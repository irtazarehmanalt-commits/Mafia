# Nightfall — real-time online social deduction

**Five nights. One liar.** A production-ready, server-authoritative multiplayer
Mafia game. Create a room, share a link, and play a fully synchronised game of
lies with 4–15 friends. No account, no download.

<p align="center">
  <em>Next.js · TypeScript · Socket.IO · Prisma · PostgreSQL · Redis</em>
</p>

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Testing](#testing)
- [Socket architecture](#socket-architecture)
- [Game rules](#game-rules)
- [Security model](#security-model)
- [Deployment](#deployment)

---

## What it does

- **Private rooms** with a shareable six-character code and invite link.
- **Four roles** — Mafia, Doctor, Detective, Civilian — dealt with a CSPRNG.
- **Full phase loop**: role reveal → night → resolution → morning → discussion →
  voting → verdict → night…
- **Server-authoritative everything**: roles, timers, targets, tallies, deaths
  and win conditions are all decided on the server.
- **Survives refreshes and dropped connections.** A player who reloads mid-night
  comes back to the same role, the same phase and an accurate countdown.
- **Channel-scoped chat** — town, Mafia-only at night, and a separate channel for
  the dead.
- **Spectators**, **rematches**, **host controls** and a redacted **event log**.
- **A Modernist UI** — sharp corners, Archivo, oversized editorial type and one
  hot accent — that inverts to a dark theme for every night phase and works
  properly on a phone.

### The design system

The look is defined once, in `apps/web/src/app/globals.css`, as a set of CSS
custom properties plus a small library of component classes (`.btn`, `.input`,
`.seg`, `.tile`, `.av`, `.tag`, `.lbl`, `.mono`, `.kv`, `.stat`, `.table`,
`.dialog`). Semantic colours resolve to those properties, so adding `.dark` to a
wrapper re-points the whole palette: that single class is what flips role
reveal, night, voting and game over to the inverted theme without any screen
carrying two sets of styles. Corners are square everywhere (`--radius-*: 0`) and
structure is held by 2px rules rather than shadows.

---

## Architecture

Four packages in one npm workspace. The dependency arrows only ever point
inward — the game rules know nothing about HTTP, sockets or React.

```
┌─────────────────────────────────────────────────────────────────┐
│  apps/web — Next.js 15 (App Router)                             │
│  Renders whatever the server says. Holds no game rules.         │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Socket.IO (typed events + Zod)
                            │  REST only for: create room, mint token
┌───────────────────────────▼─────────────────────────────────────┐
│  apps/server — Express + Socket.IO                              │
│                                                                 │
│   SocketService   auth, rate limits, schema validation          │
│   RoomManager     registry, room codes, tokens, hydration       │
│   RoomRuntime     one per room: timers + who-gets-told-what     │
│   Persistence     StateStore (Redis) + GameRepository (Prisma)  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  packages/game-engine — pure, no I/O, 134 unit tests            │
│                                                                 │
│   GameEngine              orchestrates one room's state         │
│   GameStateMachine        legal phase transitions               │
│   RoleAssignmentService   CSPRNG shuffle + balancing            │
│   NightResolutionService  kill / protect / investigate          │
│   VotingService           tallies, ties, skips                  │
│   WinConditionService     town vs mafia parity                  │
│   ProjectionService       ← the single redaction choke point    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  packages/shared — types, Zod schemas, event names, settings     │
└─────────────────────────────────────────────────────────────────┘
```

### Key technical decisions

**The game engine is a pure module.** It performs no I/O and imports nothing
from React, Express or Socket.IO. Mutations return a list of *effects*
(`PLAYER_DIED`, `ANNOUNCEMENT`, `PRIVATE_RESULT`…) that the server translates
into emits. That is what makes the entire ruleset testable without a running
server — and it means a rule change cannot accidentally depend on transport
details.

**One redaction choke point.** `ProjectionService.forPlayer()` is the only code
allowed to turn a `GameState` into something a client sees. A `PublicPlayer` has
no `role` field at all — only `revealedRole`, which the engine sets when a role
becomes public knowledge. Auditing for information leaks means auditing one
file, and there are tests asserting a Civilian's payload contains no other
role's name anywhere.

**The night's outcome is computed but withheld.** `NIGHT_RESOLUTION` calculates
who dies and stores it in `pendingResolution` *without applying it*. The death
is applied at `DAY_ANNOUNCEMENT`. Without this, the outcome would be readable
from state several seconds before it was announced.

**Doctor saves are indistinguishable from Mafia indecision.** Both produce the
byte-identical announcement "Everyone survived the night." The successful save
is recorded as a `SERVER`-visibility event, which the projection layer drops for
every recipient.

**Timers are absolute timestamps, not countdowns.** The server sends
`phaseEndsAt` and `serverTime`; the client measures its own clock offset via
RTT-sampled pings and derives the display from those. A refresh, a suspended
tab, or a badly-set system clock all still show the correct number.

**Persistence is layered and optional.** Redis (fast, shared) in front of
Postgres (durable). With neither configured the server still runs fully — rooms
just do not survive a restart — so `npm run dev` needs zero infrastructure.

---

## Project layout

```
mafia-game/
├── apps/
│   ├── server/                     Express + Socket.IO game server
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── auth/tokens.ts      HMAC session tokens, room-scoped
│   │       ├── config/             env, logger, db, redis
│   │       ├── http/routes.ts      create room · join · preview · health
│   │       ├── persistence/        StateStore + GameRepository
│   │       ├── rooms/              RoomManager · RoomRuntime
│   │       ├── socket/             SocketService + handlers
│   │       └── utils/              room codes, rate limiting
│   └── web/                        Next.js client
│       ├── public/images/          vendored artwork (see CREDITS.md)
│       └── src/
│           ├── app/                landing · create · join · room/[code]
│           ├── components/         UI primitives + atmosphere layer
│           ├── features/game/      provider, screens, game components
│           └── lib/                api, socket, session, sound
├── packages/
│   ├── game-engine/                pure rules + 134 tests
│   └── shared/                     types, Zod schemas, event contracts
├── tools/
│   ├── e2e-smoke.mjs               drives 6 real socket clients
│   └── fetch-images.mjs            re-downloads the artwork
└── docker-compose.yml
```

---

## Getting started

### Requirements

Node.js 20+ (developed on 24) and npm 10+. Postgres and Redis are **optional**.

### Run it

```bash
npm install
npm run dev
```

- Web: <http://localhost:3000>
- Server: <http://localhost:4000>

That is the whole setup. With no `DATABASE_URL` the server runs in **ephemeral
mode** — fully playable, rooms simply live in memory.

To play alone, open the room link in a few incognito windows: each window gets
its own session token and therefore its own seat.

### With Postgres and Redis

```bash
docker compose up -d postgres redis
cp .env.example apps/server/.env
npm run db:migrate --workspace @mafia/server
npm run dev
```

### Everything in Docker

```bash
export AUTH_SECRET=$(openssl rand -base64 48)
docker compose up --build
```

---

## Environment variables

Copy `.env.example`. Every variable has a working development default except
`AUTH_SECRET` in production, which the server refuses to boot without.

| Variable                        | Used by | Required        | Purpose |
| ------------------------------- | ------- | --------------- | ------- |
| `DATABASE_URL`                  | server  | no              | Postgres. Omit for ephemeral mode. |
| `REDIS_URL`                     | server  | no              | Socket.IO adapter + shared state. |
| `AUTH_SECRET`                   | server  | **in prod**     | HMAC key for session tokens. |
| `PORT`                          | server  | no (4000)       | Listen port. |
| `CORS_ORIGIN`                   | server  | no              | Comma-separated allowed origins. |
| `LOG_LEVEL`                     | server  | no (`info`)     | pino level. |
| `NEXT_PUBLIC_APP_URL`           | web     | no              | Base URL used to build invite links. |
| `NEXT_PUBLIC_SOCKET_SERVER_URL` | web     | no              | Where the browser reaches the server. |

`NEXT_PUBLIC_*` values are inlined at **build** time, so they must be set when
the web image is built — not only at runtime.

---

## Database

Prisma models: `User`, `GameRoom`, `GamePlayer`, `Game`, `GameAction`, `Vote`,
`GameEvent`.

```bash
npm run db:generate --workspace @mafia/server   # regenerate the client
npm run db:migrate  --workspace @mafia/server   # create + apply a migration
npm run db:deploy   --workspace @mafia/server   # apply in production
npm run db:studio   --workspace @mafia/server   # browse the data
```

The live game lives in memory and is mirrored to `Game.stateSnapshot` on a
debounce, which is what makes a mid-game restart recoverable. Role data is
written only where recovery needs it: when a game ends, `GamePlayer.role` and
`team` are cleared and the now-public roster is kept on `Game.result`.

---

## Testing

```bash
npm test              # 134 unit tests over the game engine
npm run test:coverage
npm run test:e2e      # 33 checks against a running server
```

The unit suite covers role assignment and balancing, Mafia targeting rules,
Doctor protection (including the consecutive-nights limit and self-protection
toggle), Detective investigations, night resolution, voting, ties, skips, win
conditions, death handling, disconnect and reconnect, invalid actions in every
phase, phase-transition legality, and projection redaction.

Edge cases explicitly tested include: the Doctor protecting the Mafia's exact
target; a Detective investigating a dead player; the last Mafia being voted out;
Mafia reaching parity; every player disconnecting at once; a player refreshing
mid-night; an action submitted one millisecond before the deadline (and one
after); simultaneous votes; the host dying mid-game; and a Mafia member
disconnecting before resolution.

`npm run test:e2e` needs the server running (`npm run dev:server`). It opens six
real Socket.IO clients and plays a complete game, asserting among other things
that a Civilian's payload contains no other player's role and that a Detective's
result reaches exactly one socket.

It also runs against a deployment — a fast way to confirm a release actually
works over `wss://` before pointing the front-end at it:

```bash
node tools/e2e-smoke.mjs https://your-server.onrender.com
```

Node clients send no `Origin` header, so this bypasses CORS and tests the
socket layer itself.

---

## Socket architecture

Each room maps to a Socket.IO room named after its code (`AB7K9X`). Every socket
*also* joins a private room `player:<uuid>`, which is how per-recipient data is
delivered without a `fetchSockets()` scan — and it keeps working once the Redis
adapter is fanning out across instances.

**Client → server** (every one Zod-validated, rate-limited and membership-checked)

| Event | Purpose |
| ----- | ------- |
| `room:join` | Authenticate with a token and claim/reclaim a seat |
| `room:leave` · `room:kick` · `room:transferHost` · `room:cancel` | Roster + host controls |
| `room:updateSettings` · `room:setReady` | Lobby configuration |
| `game:start` · `game:endEarly` | Host lifecycle |
| `game:action` | Submit a night ability |
| `game:vote` | Cast, change or retract a day vote |
| `game:chat` · `game:rematch` | Chat and rematch voting |
| `ping:rtt` | Clock synchronisation |

**Server → client**

| Event | Purpose |
| ----- | ------- |
| `room:state` | Complete redacted snapshot for one recipient |
| `room:playerJoined` · `room:playerLeft` · `room:closed` · `room:kicked` | Roster changes |
| `game:started` · `game:phaseChanged` · `game:timer` | Phase and clock |
| `game:playerDied` · `game:announcement` · `game:voteUpdated` | Public events |
| `game:privateResult` | One recipient only (e.g. an investigation) |
| `game:chat` · `game:event` · `game:over` · `game:reset` · `game:error` | |

All payloads are typed via `ClientToServerEvents` / `ServerToClientEvents` in
`@mafia/shared`, so a mismatch between the two ends is a compile error.

---

## Game rules

**Setup.** 4–15 players. Role counts are derived from the table size — 6–7: 1
Mafia; 8–10: 2; 11–15: 3, always with 1 Doctor and 1 Detective. The Mafia can
never start at or above parity, and there is always at least one plain Civilian.
A host may override the counts; the override is clamped to keep the game
startable.

**Night.** The Mafia agree on a victim by plurality among living members — a
unique top choice is killed, a tie kills nobody. A lone Mafia therefore simply
picks. The Doctor protects one player (self-protection is configurable, and the
same player cannot be protected more than two nights running by default). The
Detective learns whether one player is Mafia. Nobody learns what anyone else
did.

**Morning.** If the Mafia's target was not protected, they die and — by default
— their role is revealed. Otherwise: "Everyone survived the night", worded
identically whether the Doctor saved them or the Mafia failed to agree.

**Day.** Discussion, then a vote. Living players vote for a living player or
skip, and may change their vote until the timer ends. The highest count is
eliminated; a tie eliminates nobody by default (a random tie-break is
configurable). If skip wins, nobody is eliminated.

**Winning.** Town wins when the last Mafia dies. Mafia win the moment living
Mafia ≥ living town, because the town can no longer out-vote them. Checked after
every night resolution and every elimination.

**Disconnects.** A player keeps their seat, role and state for the whole grace
window (90s by default). By default an absent player simply stays inactive and
their vote is skipped; the room can be set to eliminate them instead. A
reconnecting player *never* gets a new role.

---

## Security model

The client is treated as hostile.

- **Nothing sensitive is sent.** Roles, night targets, investigation results and
  secret events are stripped by `ProjectionService` before anything leaves the
  server. `PublicPlayer` has no `role` field to leak.
- **Identity is a signed token, scoped to one room.** Presenting a valid token
  for room A grants nothing in room B (tested). Tokens are HMAC-SHA256 with a
  constant-time comparison and a 12-hour TTL.
- **Every action is re-derived server-side.** The server never trusts a client's
  claim about who it is or what role it holds. A payload asserting
  `action: MAFIA_KILL` is rejected unless the *server's* record says the caller
  is Mafia, alive, in the right phase, and targeting a legal player.
- **Every payload is Zod-validated** at the socket boundary, and membership is
  re-checked on every call — a token is not a permanent seat.
- **Per-socket rate limiting** with a token bucket, tuned so normal play never
  trips it.
- **Errors are stable codes**, never raw exceptions or stack traces.
- **Logs redact** tokens and roles.

---

## Deployment

**Recommended topology**

| Piece | Where |
| ----- | ----- |
| Web (Next.js) | Vercel, or the provided Dockerfile |
| Server (Socket.IO) | Railway / Render / Fly.io / a VPS — anywhere with real WebSocket support |
| Postgres | Any managed Postgres |
| Redis | Any managed Redis |

The web app is static-friendly and can go on Vercel; the socket server needs a
host that keeps long-lived connections open, so it does **not** belong on a
serverless platform.

```bash
npm run build     # builds server (tsup) and web (next build)
npm start
```

**Scaling out.** Set `REDIS_URL` and the Socket.IO Redis adapter turns on
automatically, fanning emits across instances. Enable **sticky sessions** at the
load balancer: `RoomRuntime` — which owns a room's timers — lives on one
instance, so a room's traffic should land consistently. Rooms rehydrate from
Redis (then Postgres) on demand, so an instance restart or a room moving between
instances is recoverable rather than fatal.

**Before going live**

- [ ] Set a strong `AUTH_SECRET` (`openssl rand -base64 48`). The server refuses
      to start in production with the development default.
- [ ] Set `CORS_ORIGIN` to your real web origin.
- [ ] Point `NEXT_PUBLIC_SOCKET_SERVER_URL` at the server **at build time**.
- [ ] Run `npm run db:deploy --workspace @mafia/server`.
- [ ] Confirm your host supports WebSockets and sticky sessions.

`GET /api/health` returns uptime plus live room and player counts.

---

## Credits

Type is [Archivo](https://fonts.google.com/specimen/Archivo), self-hosted via
`next/font`. The interface uses no photography.

The photographs in `apps/web/public/images` are left over from an earlier
cinematic treatment and are no longer referenced by any screen — delete the
folder, or run `npm run assets:fetch` to restore them if you want that look
back. See [CREDITS.md](apps/web/public/images/CREDITS.md) for their licensing.
