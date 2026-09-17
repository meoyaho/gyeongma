import './env.js';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { RACE_DISTANCE, MIN_SPEED, speedForCalls } from '../shared/rules.js';
import { checkName } from './name-check.js';
import { saveRoom, deleteRoom } from './room-store.js';
import { getRankedAiHorseNames } from './kra-rankings.js';
import { resumeHash, disconnectPlayer, resumePlayer, expiredLobbyPlayers } from './room-session.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const rooms = new Map();
const roomWrites = new Map();
const frontendOrigins = new Set((process.env.FRONTEND_ORIGINS || 'https://meoyaho.github.io').split(',').map(origin => origin.trim()).filter(Boolean));
function originAllowed(origin, host) {
  if (!origin) return true;
  try { return new URL(origin).host === host || frontendOrigins.has(new URL(origin).origin); }
  catch { return false; }
}
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin, req.headers.host)) return res.sendStatus(403);
  if (origin && frontendOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
const nameRequests = new Map();
function allowNameRequest(key) {
  const now = Date.now();
  for (const [ip, window] of nameRequests) if (window.until <= now) nameRequests.delete(ip);
  const window = nameRequests.get(key) || { count: 0, until: now + 60_000 };
  if (window.count++ >= 30 || (!nameRequests.has(key) && nameRequests.size >= 5000)) return false;
  nameRequests.set(key, window);
  return true;
}
function persist(room) {
  const snapshot = { ...room, players: room.players.map(player => ({ ...player })) };
  const write = (roomWrites.get(room.code) || Promise.resolve()).catch(() => {}).then(() => saveRoom(snapshot));
  roomWrites.set(room.code, write);
  write.catch(error => console.error('Firebase room save failed:', error.message)).finally(() => { if (roomWrites.get(room.code) === write) roomWrites.delete(room.code); });
  return write;
}
function removePersisted(code) {
  const write = (roomWrites.get(code) || Promise.resolve()).catch(() => {}).then(() => deleteRoom(code));
  roomWrites.set(code, write);
  write.catch(error => console.error('Firebase room delete failed:', error.message)).finally(() => { if (roomWrites.get(code) === write) roomWrites.delete(code); });
}
function inviteRoom(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{6}$/.test(normalized)) return null;
  return rooms.get(normalized) || null;
}
function joinProblem(room, name, playerId = null) {
  if (!room || room.mode !== 'friends') return { code: 'ROOM_NOT_FOUND', message: '초대방을 찾을 수 없어요. 링크를 다시 확인해주세요.' };
  if (room.phase !== 'lobby') return { code: 'ROOM_STARTED', message: '이미 시작된 경주예요. 새 초대 링크로 참여해주세요.' };
  if (!playerId && room.players.length >= 8) return { code: 'ROOM_FULL', message: '8명이 모두 모였어요. 다른 방에 참여해주세요.' };
  if (name && room.players.some(player => player.id !== playerId && player.name === name)) return { code: 'DUPLICATE_ROOM_NAME', message: '이 방에 같은 이름의 말이 있어요. 다른 이름을 지어주세요.' };
  return null;
}
function nextLane(room) {
  const used = new Set(room.players.map(player => player.lane));
  let lane = 0;
  while (used.has(lane) && lane < 8) lane++;
  return lane;
}
function nextAppearance(room, preferred) {
  const used = new Set(room.players.map(player => player.appearance));
  const available = Array.from({ length: 8 }, (_, index) => index).filter(index => !used.has(index));
  if (Number.isInteger(preferred) && available.includes(preferred)) return preferred;
  return available[randomBytes(1)[0] % available.length];
}
function inviteSummary(room) {
  return { code: room.code, playerCount: room.players.length, capacity: 8, nextLane: nextLane(room) };
}
app.get('/api/invite/:code', (req, res) => {
  const room = inviteRoom(req.params.code);
  const problem = joinProblem(room);
  if (problem) return res.status(problem.code === 'ROOM_NOT_FOUND' ? 404 : 409).json({ ok: false, ...problem });
  res.json({ ok: true, room: inviteSummary(room) });
});
app.post('/api/validate-name', async (req, res) => {
  if (!allowNameRequest(req.ip)) return res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '이름 확인 요청이 많습니다. 잠시 후 다시 시도해주세요.' });
  const result = await checkName(req.body?.name);
  if (result.ok && req.body?.roomCode) {
    const room = inviteRoom(req.body.roomCode);
    const reservation = room?.players.find(player => player.resumeHash === resumeHash(req.body.reservationToken));
    const problem = joinProblem(room, req.body.name, reservation?.id);
    if (problem) return res.status(problem.code === 'ROOM_NOT_FOUND' ? 404 : 200).json({ ok: false, ...problem });
    return res.json({ ...result, room: inviteSummary(room) });
  }
  res.status(['LOOKUP_UNAVAILABLE', 'AI_UNAVAILABLE', 'AI_NOT_CONFIGURED'].includes(result.code) ? 503 : 200).json(result);
});
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
function send(ws, data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function snapshot(room, now = Date.now()) {
  return { type: 'state', code: room.code, mode: room.mode, phase: room.phase, host: room.host, startAt: room.startAt, serverNow: now, distance: RACE_DISTANCE,
    players: room.players.map(({ ws, calls, resumeHash: _resumeHash, token: _token, ...p }) => p) };
}
function broadcast(room) { const data = snapshot(room); room.players.forEach(p => send(p.ws, data)); }
function player(ws, name, lane, appearance, token = null) { return { id: randomUUID(), resumeHash: token ? resumeHash(token) : null, name, lane, appearance, ready: false, bot: false, connected: true, reserved: !name, distance: 0, speed: MIN_SPEED, calls: [], totalCalls: 0, finishTime: null, ws, token }; }
function removePlayer(room, playerId) {
  room.players = room.players.filter(p => p.id !== playerId);
  if (!room.players.some(p => !p.bot)) { rooms.delete(room.code); removePersisted(room.code); return; }
  if (room.host === playerId) room.host = (room.players.find(p => !p.bot && p.connected) || room.players.find(p => !p.bot))?.id;
  if (room.phase === 'lobby') persist(room);
  broadcast(room);
}
// A deliberate "leave" (user clicked out) removes the seat immediately.
function leave(ws) {
  ws.joinGeneration = (ws.joinGeneration || 0) + 1;
  ws.pendingJoin = false;
  const room = rooms.get(ws.roomCode);
  ws.roomCode = null;
  if (!room) return;
  const p = room.players.find(p => p.id === ws.playerId);
  if (p && p.ws === ws) removePlayer(room, p.id);
}
// A network drop (tab backgrounded to share a link, brief signal loss, etc.) keeps the seat
// for a grace window so the player can resume with their token instead of losing the room.
function disconnect(ws) {
  ws.joinGeneration = (ws.joinGeneration || 0) + 1;
  ws.pendingJoin = false;
  const room = rooms.get(ws.roomCode);
  ws.roomCode = null;
  if (!room) return;
  if (!disconnectPlayer(room, ws)) return;
  if (room.phase === 'lobby') persist(room);
  broadcast(room);
}
wss.on('connection', (ws, req) => {
  // Browsers may only connect from this host; allow non-browser test clients.
  if (req.headers.origin) {
    if (!originAllowed(req.headers.origin, req.headers.host)) return ws.close(1008, 'Origin not allowed');
  }
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  let messages = 0, windowStart = Date.now();
  ws.on('message', async raw => {
    if (Date.now() - windowStart > 1000) { messages = 0; windowStart = Date.now(); }
    if (++messages > 40) return;
    try {
      const msg = JSON.parse(raw);
      const fail = message => send(ws, { type: 'error', message });
      if (msg.type === 'reserve') {
        if (ws.roomCode) return fail('이미 참가 자리를 배정받았어요.');
        const room = inviteRoom(msg.code);
        const problem = joinProblem(room);
        if (problem) return fail(problem.message);
        const token = randomBytes(24).toString('base64url');
        const p = player(ws, '', nextLane(room), nextAppearance(room), token);
        room.players.push(p);
        ws.roomCode = room.code; ws.playerId = p.id;
        try { await persist(room); }
        catch {
          room.players = room.players.filter(player => player !== p);
          ws.roomCode = null; ws.playerId = null;
          return fail('참가 자리를 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
        }
        send(ws, { type: 'reserved', id: p.id, code: room.code, lane: p.lane, appearance: p.appearance, reservationToken: token });
        delete p.token;
        broadcast(room);
        return;
      }
      if (msg.type === 'claim') {
        const room = rooms.get(ws.roomCode);
        const p = room?.players.find(player => player.id === ws.playerId);
        if (!room || !p?.reserved || p.resumeHash !== resumeHash(msg.reservationToken)) return fail('참가 자리를 확인하지 못했어요. 링크를 다시 열어주세요.');
        if (ws.pendingJoin) return fail('이름을 확인 중입니다. 잠시 기다려주세요.');
        if (!allowNameRequest(req.socket.remoteAddress)) return fail('이름 확인 요청이 많습니다. 잠시 후 다시 시도해주세요.');
        const generation = ws.joinGeneration = (ws.joinGeneration || 0) + 1;
        ws.pendingJoin = true;
        const valid = await checkName(msg.name);
        if (ws.joinGeneration !== generation || ws.readyState !== WebSocket.OPEN) return;
        ws.pendingJoin = false;
        if (!valid.ok) return fail(valid.message);
        const problem = joinProblem(room, msg.name, p.id);
        if (problem) return fail(problem.message);
        p.name = msg.name; p.reserved = false;
        try { await persist(room); }
        catch {
          p.name = ''; p.reserved = true;
          return fail('이름을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
        }
        send(ws, { type: 'joined', id: p.id, code: room.code, name: p.name, mode: room.mode, resumeToken: msg.reservationToken });
        broadcast(room);
        return;
      }
      if (msg.type === 'resume') {
        if (ws.roomCode) return fail('이미 경주에 참여 중이에요.');
        const room = rooms.get(msg.code);
        const p = resumePlayer(room, ws, msg);
        if (!p) return send(ws, { type: 'error', code: 'RESUME_FAILED', message: '대기실 복구 시간이 지났거나 방이 종료됐어요. 새 초대방을 만들어주세요.' });
        send(ws, p.reserved
          ? { type: 'reserved', id: p.id, code: room.code, lane: p.lane, appearance: p.appearance, reservationToken: msg.resumeToken }
          : { type: 'joined', id: p.id, code: room.code, name: p.name, mode: room.mode, resumeToken: msg.resumeToken });
        if (room.phase === 'lobby') persist(room);
        broadcast(room);
        return;
      }
      if (msg.type === 'create' || msg.type === 'join') {
        if (ws.roomCode) return fail('이미 경주에 참여 중이에요. 먼저 나가주세요.');
        if (ws.pendingJoin) return fail('이름을 확인 중입니다. 잠시 기다려주세요.');
        if (!allowNameRequest(req.socket.remoteAddress)) return fail('이름 확인 요청이 많습니다. 잠시 후 다시 시도해주세요.');
        const generation = ws.joinGeneration = (ws.joinGeneration || 0) + 1;
        ws.pendingJoin = true;
        const valid = await checkName(msg.name);
        if (ws.joinGeneration !== generation || ws.readyState !== WebSocket.OPEN) return;
        ws.pendingJoin = false;
        if (!valid.ok) return fail(valid.message);
        let room;
        if (msg.type === 'create') {
          if (rooms.size >= 500) return fail('대기실이 가득 찼어요. 잠시 후 다시 시도해주세요.');
          let code;
          do { code = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(code));
          room = { code, mode: msg.mode === 'friends' ? 'friends' : 'solo', phase: 'lobby', host: null, startAt: null, lastTick: Date.now(), createdAt: Date.now(), players: [] };
          rooms.set(code, room);
        } else {
          room = inviteRoom(msg.code);
          const problem = joinProblem(room, msg.name);
          if (problem) return fail(problem.message);
        }
        const lane = nextLane(room);
        const resumeToken = randomBytes(24).toString('base64url');
        const p = player(ws, msg.name, lane, nextAppearance(room, msg.type === 'create' ? msg.appearance : undefined), resumeToken);
        room.players.push(p);
        if (!room.host) room.host = p.id;
        ws.roomCode = room.code; ws.playerId = p.id;
        if (room.mode === 'solo') {
          const rankedAiHorseNames = await getRankedAiHorseNames();
          for (let i = 1; i < 8; i++) room.players.push({ ...player(null, rankedAiHorseNames[i - 1], i, nextAppearance(room)), id: `bot-${i}`, ready: true, bot: true });
        }
        if (room.mode === 'friends') {
          try { await persist(room); }
          catch {
            room.players = room.players.filter(player => player !== p);
            if (!room.players.length) rooms.delete(room.code);
            return fail('대기실을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
          }
        }
        send(ws, { type: 'joined', id: p.id, code: room.code, name: p.name, mode: room.mode, resumeToken });
        delete p.token;
        broadcast(room);
        return;
      }
      if (msg.type === 'leave') return leave(ws);
      const room = rooms.get(ws.roomCode);
      if (!room) return fail('먼저 대기실에 입장해주세요.');
      const p = room.players.find(p => p.id === ws.playerId);
      if (!p) return;
      if (msg.type === 'ready' && room.phase === 'lobby') { p.ready = msg.ready === true; persist(room); broadcast(room); }
      if (msg.type === 'rematch' && room.phase === 'finished') {
        if (room.host !== p.id) return fail('방장이 다음 경주를 준비할 수 있어요.');
        room.players = room.players.filter(p => p.connected);
        for (const racer of room.players) Object.assign(racer, { distance: 0, speed: MIN_SPEED, calls: [], totalCalls: 0, finishTime: null, ready: racer.bot });
        room.phase = 'lobby'; room.startAt = null; persist(room); broadcast(room);
      }
      if (msg.type === 'start') {
        if (room.host !== p.id) return fail('방장만 경주를 시작할 수 있어요.');
        if (room.phase !== 'lobby') return;
        if (room.mode === 'friends' && room.players.filter(p => p.connected).length < 2) return fail('친구가 한 명 이상 입장해야 시작할 수 있어요.');
        if (!room.players.every(p => p.connected && p.ready)) return fail('모든 참가자가 접속하고 준비를 마쳐야 해요.');
        room.phase = 'countdown'; room.startAt = Date.now() + 3500; room.lastTick = room.startAt; broadcast(room);
        if (room.mode === 'friends') removePersisted(room.code);
      }
      if (msg.type === 'call' && room.phase === 'racing' && !p.finishTime) {
        const now = Date.now();
        p.calls = p.calls.filter(t => now - t < 2000);
        const count = Math.max(0, Math.min(4, Math.floor(Number(msg.count) || 0), 8 - p.calls.length));
        for (let i = 0; i < count; i++) p.calls.push(now);
        p.totalCalls += count;
      }
    } catch { send(ws, { type: 'error', message: '요청을 처리하지 못했어요.' }); }
  });
  ws.on('close', () => disconnect(ws));
  ws.on('error', () => {});
});
const ticker = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.createdAt > 30 * 60 * 1000) { room.players.forEach(p => { send(p.ws, { type: 'expired' }); p.ws?.close(); }); rooms.delete(room.code); removePersisted(room.code); continue; }
    if (room.phase === 'lobby') {
      const stale = expiredLobbyPlayers(room, now);
      if (stale.length) { stale.forEach(p => removePlayer(room, p.id)); if (!rooms.has(room.code)) continue; }
    }
    if (room.phase === 'countdown' && now >= room.startAt) room.phase = 'racing';
    if (room.phase !== 'racing') continue;
    // Integrate elapsed wall time: event-loop delay never changes race length.
    const dt = (now - room.lastTick) / 1000;
    room.lastTick = now;
    for (const p of room.players) {
      if (p.finishTime !== null || !p.connected) continue;
      p.calls = p.calls.filter(t => now - t < 2000);
      p.speed = p.bot ? 10.5 + p.lane * .62 + Math.sin((now - room.startAt) / 1400 + p.lane) * 1.2 : speedForCalls(p.calls, now);
      const remaining = RACE_DISTANCE - p.distance;
      if (p.speed * dt >= remaining) { p.finishTime = (now - room.startAt) / 1000 - dt + remaining / p.speed; p.distance = RACE_DISTANCE; }
      else p.distance += p.speed * dt;
    }
    if (room.players.every(p => p.finishTime !== null || !p.connected)) room.phase = 'finished';
    broadcast(room);
  }
}, 50);
const heartbeat = setInterval(() => { wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.ping(); }); }, 15000);

if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')));
  app.get('*', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => console.log(`말 달리자 → http://localhost:${port}`));
function shutdown() { clearInterval(ticker); clearInterval(heartbeat); wss.clients.forEach(ws => ws.terminate()); server.close(() => process.exit(0)); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
