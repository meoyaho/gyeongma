import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { horseAppearance } from '../shared/horse-appearances.js';
// Run against a dev or production server: npm run dev (separate terminal).
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
const wsOrigin = origin.replace(/^http/, 'ws');
function client() {
  const socket = new WebSocket(`${wsOrigin}/ws`), messages = [], waiters = [];
  socket.on('message', raw => { const data = JSON.parse(raw); messages.push(data); waiters.forEach(w => w(data)); });
  const ready = new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });
  const wait = (predicate, timeout = 30000) => new Promise((resolve, reject) => {
    const prior = messages.find(predicate); if (prior) return resolve(prior);
    const timer = setTimeout(() => { waiters.splice(waiters.indexOf(listener), 1); reject(new Error('Timed out waiting for server message')); }, timeout);
    const listener = data => { if (predicate(data)) { clearTimeout(timer); waiters.splice(waiters.indexOf(listener), 1); resolve(data); } }; waiters.push(listener);
  });
  return { socket, ready, wait, messages, send: data => socket.send(JSON.stringify(data)), clear: () => { messages.length = 0; } };
}
test('name validation endpoint rejects invalid names', async () => {
  const res = await fetch(`${origin}/api/validate-name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '삼성전자' }) });
  assert.equal((await res.json()).ok, false);
});
test('registered names are rejected by HTTP and direct WebSocket requests', async t => {
  const res = await fetch(`${origin}/api/validate-name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '트리플나인' }) });
  const result = await res.json();
  assert.equal(result.ok, false);
  assert.match(result.code, /^(EXISTING_HORSE|AI_)/);
  const c = client(); t.after(() => c.socket.close()); await c.ready;
  c.send({ type: 'create', mode: 'solo', name: '트리플나인' });
  assert.ok((await c.wait(d => d.type === 'error')).message);
  assert.equal(c.messages.some(d => d.type === 'joined'), false);
  c.clear(); c.send({ type: 'create', mode: 'solo', name: '이준석질주' });
  assert.ok((await c.wait(d => d.type === 'error')).message);
  assert.equal(c.messages.some(d => d.type === 'joined'), false);
});
test('solo adds 7 AI; enforces readiness; caps acceleration; silence decays', async t => {
  const c = client(); t.after(() => c.socket.close()); await c.ready;
  c.send({ type: 'create', mode: 'solo', name: '바람을따라', appearance: 6 });
  const joined = await c.wait(d => d.type === 'joined');
  const lobby = await c.wait(d => d.type === 'state');
  assert.equal(lobby.players.find(p => p.id === joined.id).appearance, 6, 'solo keeps the preview horse');
  assert.equal(new Set(lobby.players.map(p => p.appearance)).size, 8, 'AI horses do not duplicate the preview horse');
  assert.equal(lobby.players.length, 8); assert.equal(lobby.players.filter(p => p.bot).length, 7);
  assert.equal(new Set(lobby.players.map(p => p.name)).size, 8);
  c.send({ type: 'start' }); assert.match((await c.wait(d => d.type === 'error')).message, /준비/);
  c.send({ type: 'ready', ready: true }); c.send({ type: 'start' });
  await c.wait(d => d.phase === 'racing');
  c.send({ type: 'call', count: 9999999 });
  const fast = await c.wait(d => d.phase === 'racing' && d.players.find(p => p.id === joined.id)?.speed === 20);
  assert.equal(fast.players.find(p => p.id === joined.id).totalCalls, 4);
  const decayed = await c.wait(d => d.phase === 'racing' && d.players.find(p => p.id === joined.id)?.totalCalls === 4 && d.players.find(p => p.id === joined.id)?.speed === 5);
  assert.ok(decayed.players[0].distance > 20);
});
test('friends room supports 8, keeps a dropped seat during the reconnect grace window, and supports resume', async t => {
  const clients = Array.from({ length: 9 }, client); t.after(() => clients.forEach(c => c.socket.close())); await Promise.all(clients.map(c => c.ready));
  const [host, ...guests] = clients;
  host.send({ type: 'create', mode: 'friends', name: '바람을따라', appearance: 3 }); const joined = await host.wait(d => d.type === 'joined');
  assert.ok(joined.resumeToken, 'a resume token lets the player reclaim its seat after a network drop');
  const lobby = await host.wait(d => d.type === 'state');
  assert.equal(lobby.players.find(p => p.id === joined.id).appearance, 3, 'friends room keeps the preview horse');
  const names = ['말이되냐','말로하자','울트라걸','내가간다','장난아냐','당근좋아','바람난다','말이되냐'];
  const invite = await fetch(`${origin}/api/invite/${joined.code}`).then(response => response.json());
  assert.equal(invite.ok, true);
  assert.equal(invite.room.playerCount, 1);
  assert.equal(invite.room.nextLane, 1);
  const duplicate = await fetch(`${origin}/api/validate-name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '바람을따라', roomCode: joined.code }),
  }).then(response => response.json());
  assert.equal(duplicate.code, 'DUPLICATE_ROOM_NAME');
  const available = await fetch(`${origin}/api/validate-name`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: names[0], roomCode: joined.code }),
  }).then(response => response.json());
  assert.equal(available.ok, true);
  assert.equal(available.room.nextLane, 1);
  // One-player friend races cannot start.
  host.send({ type: 'ready', ready: true }); host.send({ type: 'start' }); assert.match((await host.wait(d => d.type === 'error')).message, /한 명/);
  for (let i = 0; i < 7; i++) { guests[i].send({ type: 'join', code: joined.code, name: names[i] }); await guests[i].wait(d => d.type === 'joined'); }
  const full = await host.wait(d => d.type === 'state' && d.players.length === 8); assert.equal(full.players.filter(p => p.bot).length, 0);
  assert.equal(full.players.some(p => p.resumeHash || p.reservationToken || p.resumeToken), false, 'reservation credentials are private');
  assert.equal(new Set(full.players.map(p => horseAppearance(p.appearance).src)).size, 8, 'all players receive distinct horse illustrations');
  guests[7].send({ type: 'join', code: joined.code, name: names[7] }); assert.match((await guests[7].wait(d => d.type === 'error')).message, /8명/);
  guests[0].send({ type: 'start' }); assert.match((await guests[0].wait(d => d.type === 'error')).message, /방장/);
  host.clear(); host.send({ type: 'start' }); assert.match((await host.wait(d => d.type === 'error')).message, /준비/);
  // Dropping the connection (e.g. backgrounding the tab to share the invite link) must not
  // vacate the seat or transfer the host role while the grace window is open.
  host.socket.close();
  const afterDrop = await guests[0].wait(d => d.type === 'state' && d.players.find(p => p.id === joined.id)?.connected === false);
  assert.equal(afterDrop.players.length, 8, 'the disconnected host keeps its seat during the grace window');
  assert.equal(afterDrop.players.find(p => p.id === joined.id).connected, false);
  assert.equal(afterDrop.host, joined.id, 'sharing the invite does not transfer the host role');
  // The original host resumes with a fresh connection using its resume token.
  const resumed = client(); t.after(() => resumed.socket.close()); await resumed.ready;
  resumed.send({ type: 'resume', code: joined.code, playerId: joined.id, resumeToken: joined.resumeToken });
  const rejoined = await resumed.wait(d => d.type === 'joined');
  assert.equal(rejoined.id, joined.id);
  const afterResume = await resumed.wait(d => d.type === 'state' && d.players.find(p => p.id === joined.id)?.connected);
  assert.equal(afterResume.players.length, 8, 'resuming reclaims the existing seat instead of creating a duplicate');
  assert.equal(afterResume.host, joined.id, 'the returning host retains its role');
  const leader = resumed;
  leader.send({ type: 'ready', ready: true });
  for (const guest of guests.slice(0, 7)) guest.send({ type: 'ready', ready: true });
  await leader.wait(d => d.phase === 'lobby' && d.players.length === 8 && d.players.every(p => p.ready));
  leader.send({ type: 'start' });
  const starts = await Promise.all(guests.slice(0, 7).map(c => c.wait(d => d.phase === 'countdown')));
  assert.equal(new Set(starts.map(d => d.startAt)).size, 1);
});
test('server rejects malformed names and missing invite rooms', async t => {
  const c = client(); t.after(() => c.socket.close()); await c.ready;
  c.send({ type: 'create', name: 'ㄱㄴㄷㄹ' }); assert.match((await c.wait(d => d.type === 'error')).message, /한글/);
  c.clear(); c.send({ type: 'join', name: '바람을따라', code: 'NOPE' }); assert.match((await c.wait(d => d.type === 'error')).message, /찾을 수/);
});
