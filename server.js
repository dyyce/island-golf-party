// Island Golf Party server: serves the static client and runs authoritative
// room-based multiplayer over WebSocket. The server owns all physics.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { course as COURSE_TEMPLATE } from './js/course-data.js';
import { step, allRested, clampSpeed, MAX_SPEED } from './js/physics.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_STROKES = 12;
const MAX_PLAYERS = 4;
const TICK_MS = 33; // ~30Hz physics + snapshots
const PALETTE = [0xe64545, 0x3f7fff, 0x2e9e44, 0xb44fe6, 0xff8f3f, 0xe6cf4f];

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json',
};

// ---------- static files ----------
const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') path = '/index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || file.includes(`${ROOT}.git`)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

// ---------- rooms ----------
const rooms = new Map(); // code -> room
let nextClientId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg) {
  for (const c of room.clients.values()) send(c.ws, msg);
}

function lobbyState(room) {
  return {
    t: 'lobby',
    code: room.code,
    hostId: room.hostId,
    players: [...room.clients.values()].map(c => ({ id: c.id, name: c.name, color: c.color })),
  };
}

function startRound(room) {
  const course = structuredClone(COURSE_TEMPLATE); // spinner angle mutates per room
  room.course = course;
  const ids = [...room.clients.values()];
  room.players = ids.map((c, i) => ({
    id: c.id, name: c.name, color: c.color,
    strokes: 0, holed: false, sinkT: 0,
    ball: {
      pos: { x: course.tee.x, z: course.tee.z + (i - (ids.length - 1) / 2) * 0.55 },
      vel: { x: 0, z: 0 },
      restPos: null, holed: false, inWater: false,
    },
  }));
  for (const p of room.players) p.ball.restPos = { ...p.ball.pos };
  room.current = 0;
  room.status = 'playing';
  room.moving = false;
  room.pendingTurnAdvance = false;
  room.respawnQueue = [];
  broadcast(room, { t: 'started', players: room.players.map(publicPlayer) });
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, strokes: p.strokes, holed: p.holed };
}

function nextTurn(room) {
  if (room.players.every(p => p.holed)) {
    room.status = 'over';
    broadcast(room, { t: 'over', players: room.players.map(publicPlayer) });
    return;
  }
  do { room.current = (room.current + 1) % room.players.length; } while (room.players[room.current].holed);
}

function tickRoom(room, dt) {
  if (room.status !== 'playing') return;
  const events = { bounce: false, bumper: false, splash: null, holed: null };
  const balls = room.players.map(p => p.ball);
  // substeps so fast balls can't tunnel through thin walls
  const SUBSTEPS = 4;
  for (let i = 0; i < SUBSTEPS; i++) step(room.course, balls, dt / SUBSTEPS, events);

  const out = [];
  if (events.bounce) out.push({ e: 'bounce' });
  if (events.bumper) out.push({ e: 'bumper' });
  if (events.splash) {
    const p = room.players.find(pl => pl.ball === events.splash);
    if (p) {
      p.strokes += 1; // water penalty
      room.respawnQueue.push({ p, t: 0.9 });
      out.push({ e: 'splash', id: p.id });
    }
  }
  if (events.holed) {
    const p = room.players.find(pl => pl.ball === events.holed);
    if (p && !p.holed) {
      p.holed = true;
      out.push({ e: 'hole', id: p.id, strokes: p.strokes });
    }
  }

  // respawns
  for (const r of room.respawnQueue) r.t -= dt;
  for (const r of room.respawnQueue.filter(r => r.t <= 0)) {
    r.p.ball.pos = { ...r.p.ball.restPos };
    r.p.ball.inWater = false;
    out.push({ e: 'respawn', id: r.p.id });
  }
  room.respawnQueue = room.respawnQueue.filter(r => r.t > 0);

  // turn advance once everything rests and respawns are done
  const moving = !allRested(balls);
  if (room.moving && !moving) room.pendingTurnAdvance = true;
  if (room.pendingTurnAdvance && !moving && room.respawnQueue.length === 0) {
    room.pendingTurnAdvance = false;
    for (const p of room.players) {
      if (!p.ball.holed && !p.ball.inWater) p.ball.restPos = { ...p.ball.pos };
      if (p.strokes >= MAX_STROKES && !p.holed) { p.holed = true; p.ball.holed = true; }
    }
    nextTurn(room);
  }
  room.moving = moving;
  room.rested = !moving && room.respawnQueue.length === 0;

  if (out.length) broadcast(room, { t: 'events', events: out });
  broadcast(room, {
    t: 'state',
    current: room.players[room.current]?.id,
    rested: room.rested,
    spinner: room.course.spinner.angle,
    players: room.players.map(p => ({
      id: p.id, strokes: p.strokes, holed: p.holed,
      x: +p.ball.pos.x.toFixed(3), z: +p.ball.pos.z.toFixed(3),
      inWater: p.ball.inWater,
    })),
  });
}

setInterval(() => {
  const dt = TICK_MS / 1000;
  for (const room of rooms.values()) tickRoom(room, dt);
}, TICK_MS);

// ---------- websocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  const client = { id: nextClientId++, ws, name: '', color: 0xffffff };
  let room = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'create' || msg.t === 'join') {
      client.name = String(msg.name || 'Player').slice(0, 12);
      client.color = msg.color | 0;
      if (msg.t === 'create') {
        const code = makeCode();
        room = { code, hostId: client.id, clients: new Map(), status: 'lobby', players: [] };
        room.clients.set(client.id, client);
        rooms.set(code, room);
      } else {
        room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room || room.status !== 'lobby' || room.clients.size >= MAX_PLAYERS) {
          send(ws, { t: 'error', error: room ? 'Room is full or already playing.' : 'Room not found.' });
          room = null;
          return;
        }
        room.clients.set(client.id, client);
      }
      // avoid duplicate ball colors in a room
      const others = [...room.clients.values()].filter(c => c.id !== client.id).map(c => c.color);
      if (others.includes(client.color)) {
        const free = PALETTE.find(c => !others.includes(c));
        if (free !== undefined) client.color = free;
      }
      send(ws, { t: 'me', id: client.id });
      broadcast(room, lobbyState(room));
      return;
    }

    if (!room) return;

    if (msg.t === 'start' && client.id === room.hostId && room.status !== 'playing') {
      startRound(room);
      return;
    }

    if (msg.t === 'shoot' && room.status === 'playing') {
      const me = room.players[room.current];
      if (!me || me.id !== client.id || !room.rested || me.ball.inWater) return;
      me.ball.vel.x = +msg.x || 0;
      me.ball.vel.z = +msg.z || 0;
      clampSpeed(me.ball.vel);
      if (Math.hypot(me.ball.vel.x, me.ball.vel.z) > MAX_SPEED * 0.05) {
        me.strokes += 1;
        room.moving = true;
      }
      return;
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(client.id);
    const idx = room.players.findIndex(p => p.id === client.id);
    if (idx >= 0) {
      // drop their ball from the round; fix up turn order
      room.players.splice(idx, 1);
      if (room.players.length === 0) { rooms.delete(room.code); return; }
      if (room.status === 'playing') {
        if (idx < room.current) room.current -= 1;
        else if (idx === room.current) { room.current %= room.players.length; room.pendingTurnAdvance = false; }
        if (room.players.every(p => p.holed)) {
          room.status = 'over';
          broadcast(room, { t: 'over', players: room.players.map(publicPlayer) });
        }
      }
    }
    if (room.clients.size === 0) { rooms.delete(room.code); return; }
    if (room.hostId === client.id) room.hostId = room.clients.keys().next().value;
    broadcast(room, lobbyState(room));
  });
});

server.listen(PORT, () => console.log(`Island Golf Party listening on :${PORT}`));
