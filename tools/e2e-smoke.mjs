/**
 * End-to-end smoke test: drives six real socket clients through a complete
 * game against the running server. Verifies the HTTP handshake, socket auth,
 * per-player redaction, night actions, voting and the win condition.
 */
import { io } from 'socket.io-client';

// Defaults to a local dev server; pass a URL to smoke-test a real deployment:
//   node tools/e2e-smoke.mjs https://nightfall-server.onrender.com
const BASE = (process.argv[2] ?? process.env.MAFIA_SERVER_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);
const NAMES = ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Frank'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function post(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function connect(ticket) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'] });
    const client = { socket, ticket, state: null, events: [], deaths: [], private: [] };

    socket.on('room:state', (s) => (client.state = s));
    socket.on('game:event', (e) => client.events.push(e));
    socket.on('game:playerDied', (d) => client.deaths.push(d));
    socket.on('game:privateResult', (p) => client.private.push(p));

    socket.on('connect', () => {
      socket.emit('room:join', { roomCode: ticket.roomCode, token: ticket.token }, (res) => {
        if (!res.ok) return reject(new Error(JSON.stringify(res.error)));
        client.state = res.data;
        resolve(client);
      });
    });
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 8000);
  });
}

function emit(client, event, payload) {
  return new Promise((resolve, reject) => {
    client.socket.emit(event, payload, (res) => {
      if (res?.ok) resolve(res.data);
      else reject(new Error(`${event}: ${res?.error?.code} ${res?.error?.message}`));
    });
    setTimeout(() => reject(new Error(`${event} timed out`)), 6000);
  });
}

/** Waits until every client reports the given phase. */
async function waitForPhase(clients, phase, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (clients.every((c) => c.state?.phase === phase)) return true;
    await sleep(120);
  }
  throw new Error(
    `Timed out waiting for ${phase}; saw ${clients.map((c) => c.state?.phase).join(',')}`,
  );
}

async function main() {
  console.log('\n=== Mafia end-to-end ===\n');

  // --- Room creation & joining --------------------------------------------
  console.log('Room setup');
  const hostTicket = await post('/rooms', {
    displayName: NAMES[0],
    roomName: 'E2E Table',
    settings: {
      minPlayers: 6,
      maxPlayers: 6,
      // Every value here sits at the low end of the server's allowed range,
      // so a full game plays out in well under a minute.
      durations: {
        ROLE_REVEAL: 5,
        NIGHT: 15,
        NIGHT_RESOLUTION: 2,
        DAY_ANNOUNCEMENT: 5,
        DISCUSSION: 20,
        VOTING: 15,
        VOTE_RESOLUTION: 3,
      },
    },
  });
  check('room created', /^[A-Z2-9]{6}$/.test(hostTicket.roomCode), hostTicket.roomCode);

  const tickets = [hostTicket];
  for (const name of NAMES.slice(1)) {
    tickets.push(await post(`/rooms/${hostTicket.roomCode}/join`, { displayName: name }));
  }
  check('six tickets issued', tickets.length === 6);

  // Duplicate names must be rejected.
  let duplicateRejected = false;
  try {
    await post(`/rooms/${hostTicket.roomCode}/join`, { displayName: 'alice' });
  } catch {
    duplicateRejected = true;
  }
  check('duplicate name rejected', duplicateRejected);

  const clients = [];
  for (const ticket of tickets) clients.push(await connect(ticket));
  await sleep(400);
  check('all six seated', clients[0].state.players.length === 6);
  check('host flagged', clients[0].state.you.isHost === true);
  check('non-host not flagged', clients[1].state.you.isHost === false);

  // A non-host must not be able to start.
  let notHostRejected = false;
  try {
    await emit(clients[1], 'game:start', {});
  } catch (e) {
    notHostRejected = /NOT_HOST/.test(e.message);
  }
  check('non-host cannot start', notHostRejected);

  // --- Role reveal ---------------------------------------------------------
  console.log('\nRole assignment');
  await emit(clients[0], 'game:start', {});
  await waitForPhase(clients, 'ROLE_REVEAL');

  const roles = clients.map((c) => c.state.you.role);
  check('everyone got a role', roles.every(Boolean), roles.join(','));
  check('exactly one Mafia at 6 players', roles.filter((r) => r === 'MAFIA').length === 1);
  check('exactly one Doctor', roles.filter((r) => r === 'DOCTOR').length === 1);
  check('exactly one Detective', roles.filter((r) => r === 'DETECTIVE').length === 1);

  // The critical security property.
  const leak = clients.some((c) =>
    c.state.players.some((p) => Object.prototype.hasOwnProperty.call(p, 'role')),
  );
  check('no role field on any public player', !leak);

  const civilian = clients.find((c) => c.state.you.role === 'CIVILIAN');
  const serialised = JSON.stringify(civilian.state);
  check(
    'civilian payload contains no other role',
    !serialised.includes('"MAFIA"') && !serialised.includes('"DETECTIVE"'),
  );

  const mafia = clients.find((c) => c.state.you.role === 'MAFIA');
  const doctor = clients.find((c) => c.state.you.role === 'DOCTOR');
  const detective = clients.find((c) => c.state.you.role === 'DETECTIVE');
  console.log(
    `  (Mafia=${mafia.ticket.displayName} Doctor=${doctor.ticket.displayName} Detective=${detective.ticket.displayName})`,
  );

  // --- Night ---------------------------------------------------------------
  console.log('\nNight 1');
  await waitForPhase(clients, 'NIGHT');

  const victim = clients.find(
    (c) => c.state.you.role === 'CIVILIAN' && c.ticket.playerId !== mafia.ticket.playerId,
  );

  // Wrong-role actions must be refused.
  let wrongRole = false;
  try {
    await emit(civilian, 'game:action', {
      action: 'MAFIA_KILL',
      targetId: victim.ticket.playerId,
    });
  } catch (e) {
    wrongRole = /INVALID_ROLE_FOR_ACTION/.test(e.message);
  }
  check('civilian cannot use MAFIA_KILL', wrongRole);

  let selfKill = false;
  try {
    await emit(mafia, 'game:action', { action: 'MAFIA_KILL', targetId: mafia.ticket.playerId });
  } catch (e) {
    selfKill = /INVALID_TARGET/.test(e.message);
  }
  check('mafia cannot target themselves', selfKill);

  await emit(mafia, 'game:action', { action: 'MAFIA_KILL', targetId: victim.ticket.playerId });
  await emit(doctor, 'game:action', { action: 'DOCTOR_PROTECT', targetId: doctor.ticket.playerId });
  await emit(detective, 'game:action', {
    action: 'DETECTIVE_INVESTIGATE',
    targetId: mafia.ticket.playerId,
  });
  check('night actions accepted', true);

  // --- Day -----------------------------------------------------------------
  console.log('\nDay 1');
  await waitForPhase(clients, 'DAY_ANNOUNCEMENT', 30000);
  await sleep(300);

  check('victim is dead', victim.state.you.alive === false, victim.ticket.displayName);
  check('death broadcast to everyone', clients.every((c) => c.deaths.length === 1));
  check(
    'role revealed on death',
    clients[0].deaths[0]?.revealedRole === 'CIVILIAN',
    String(clients[0].deaths[0]?.revealedRole),
  );

  check('detective got a private result', detective.private.length === 1);
  check('detective result is correct', detective.private[0]?.isMafia === true);
  const othersLeaked = clients.filter((c) => c !== detective).some((c) => c.private.length > 0);
  check('investigation reached nobody else', !othersLeaked);

  // The dead cannot act.
  let deadVote = false;
  await waitForPhase(clients, 'VOTING', 40000);
  try {
    await emit(victim, 'game:vote', { targetId: mafia.ticket.playerId });
  } catch (e) {
    deadVote = /NOT_ALIVE/.test(e.message);
  }
  check('dead player cannot vote', deadVote);

  // --- Vote out the Mafia --------------------------------------------------
  console.log('\nThe vote');
  const livingVoters = clients.filter(
    (c) => c.state.you.alive && c.ticket.playerId !== mafia.ticket.playerId,
  );
  for (const voter of livingVoters) {
    await emit(voter, 'game:vote', { targetId: mafia.ticket.playerId });
  }
  await sleep(400);
  const tally = clients[0].state.voteTallies?.find(
    (t) => t.targetId === mafia.ticket.playerId,
  );
  check('votes tallied live', tally?.votes === livingVoters.length, `${tally?.votes} votes`);

  await waitForPhase(clients, 'GAME_OVER', 30000);
  await sleep(300);

  check('town wins', clients[0].state.result?.winner === 'TOWN');
  check('full roster revealed', clients[0].state.result?.roster?.length === 6);
  check(
    'every role now public',
    clients[0].state.players.every((p) => p.revealedRole !== null),
  );

  // --- Reconnection --------------------------------------------------------
  console.log('\nReconnection');
  const roleBefore = detective.state.you.role;
  detective.socket.disconnect();
  await sleep(500);
  const rejoined = await connect(detective.ticket);
  await sleep(400);
  check('same role after reconnect', rejoined.state.you.role === roleBefore, roleBefore);
  check('same player id', rejoined.state.you.playerId === detective.ticket.playerId);
  check('still six players', rejoined.state.players.length === 6);

  // A token minted for this room must not work anywhere else.
  let crossRoom = false;
  const other = await post('/rooms', { displayName: 'Zed', roomName: 'Other' });
  try {
    await new Promise((resolve, reject) => {
      const s = io(BASE, { transports: ['websocket'] });
      s.on('connect', () => {
        s.emit('room:join', { roomCode: other.roomCode, token: detective.ticket.token }, (res) => {
          s.disconnect();
          if (res.ok) reject(new Error('cross-room token accepted'));
          else {
            crossRoom = res.error.code === 'NOT_AUTHENTICATED';
            resolve();
          }
        });
      });
    });
  } catch (e) {
    console.log('  (cross-room) ' + e.message);
  }
  check('token is scoped to its own room', crossRoom);

  // --- Rematch -------------------------------------------------------------
  console.log('\nRematch');
  // Only clients with a live socket receive state, so assert through one of
  // those — the original detective socket was deliberately dropped above.
  const live = clients.filter((c) => c.socket.connected);
  for (const client of live.slice(0, 3)) {
    await emit(client, 'game:rematch', { vote: true });
  }
  await sleep(800);

  const observer = live[0];
  check('room returned to lobby', observer.state.phase === 'LOBBY', observer.state.phase);
  check('roles cleared', observer.state.you.role === null);
  check('everyone alive again', observer.state.players.every((p) => p.alive));
  check('rematch votes reset', observer.state.you.rematchVote === false);
  check('reconnected player still seated', rejoined.state.players.length === 6);

  for (const client of clients) client.socket.disconnect();
  rejoined.socket.disconnect();

  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  // Give open handles a tick to unwind before tearing the process down.
  setTimeout(() => process.exit(1), 100);
});
