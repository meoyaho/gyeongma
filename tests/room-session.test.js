import test from 'node:test';
import assert from 'node:assert/strict';
import { LOBBY_GRACE_MS, RESERVED_GRACE_MS, resumeHash, disconnectPlayer, resumePlayer, expiredLobbyPlayers } from '../server/room-session.js';
import { createRoomSessionStore } from '../src/room-session.js';

function fixture() {
  const socket = { playerId: 'host', roomCode: 'ABC123', close(code) { this.closeCode = code; } };
  const p = { id: 'host', connected: true, ws: socket, resumeHash: resumeHash('secret-token'), ready: true, calls: [1], speed: 20 };
  return { socket, p, room: { code: 'ABC123', phase: 'lobby', host: 'host', players: [p] }, credentials: { playerId: 'host', resumeToken: 'secret-token' } };
}
test('a lone host and invite survive a two-minute app switch and recover the same seat', () => {
  const { room, p, socket, credentials } = fixture();
  assert.equal(disconnectPlayer(room, socket, 1000), true);
  assert.equal(room.host, p.id);
  assert.equal(room.players.length, 1);
  assert.equal(p.ready, false);
  assert.deepEqual(expiredLobbyPlayers(room, 121000), []);
  const next = {};
  assert.equal(resumePlayer(room, next, credentials, 121000), p);
  assert.equal(p.ws, next);
  assert.equal(p.connected, true);
  assert.equal(p.disconnectedAt, undefined);
  assert.equal(next.roomCode, room.code);
  assert.equal(room.players.length, 1);
});
test('the lobby host keeps ownership while temporarily disconnected with guests present', () => {
  const { room, socket } = fixture();
  room.players.push({ id: 'guest', connected: true });
  disconnectPlayer(room, socket, 1000);
  assert.equal(room.host, 'host');
});
test('authenticated resume replaces a stale OPEN socket and ignores its delayed disconnect', () => {
  const { room, p, socket, credentials } = fixture();
  const next = {};
  assert.equal(resumePlayer(room, next, credentials), p);
  assert.equal(socket.closeCode, 4001);
  assert.equal(socket.roomCode, null);
  assert.equal(socket.joinGeneration, 1);
  assert.equal(disconnectPlayer(room, socket), false);
  assert.equal(p.connected, true);
  assert.equal(p.ws, next);
});
test('wrong or missing resume credentials cannot evict an active player', () => {
  const { room, p, socket, credentials } = fixture();
  for (const resumeToken of ['', undefined, 'wrong-token']) {
    assert.equal(resumePlayer(room, {}, { ...credentials, resumeToken }), null);
  }
  assert.equal(p.ws, socket);
  assert.equal(socket.closeCode, undefined);
  assert.equal(resumePlayer(null, {}, credentials), null);
});
test('grace expires at five minutes, even if cleanup has not run yet', () => {
  const { room, p, socket, credentials } = fixture();
  disconnectPlayer(room, socket, 0);
  assert.equal(LOBBY_GRACE_MS, 300000);
  assert.deepEqual(expiredLobbyPlayers(room, LOBBY_GRACE_MS - 1), []);
  assert.deepEqual(expiredLobbyPlayers(room, LOBBY_GRACE_MS), [p]);
  assert.equal(resumePlayer(room, {}, credentials, LOBBY_GRACE_MS), null);
});
test('a reserved seat resumes without turning into a named player', () => {
  const { room, p, socket, credentials } = fixture();
  p.reserved = true; p.name = '';
  disconnectPlayer(room, socket, 0);
  const resumed = resumePlayer(room, {}, credentials, 500);
  assert.equal(resumed.reserved, true);
  assert.equal(resumed.name, '');
});
test('an abandoned reserved seat (e.g. a different browser reopening the invite link) expires in 2s, not 5 minutes', () => {
  const { room, p, socket, credentials } = fixture();
  p.reserved = true; p.name = '';
  disconnectPlayer(room, socket, 0);
  assert.equal(RESERVED_GRACE_MS, 2000);
  assert.deepEqual(expiredLobbyPlayers(room, RESERVED_GRACE_MS - 1), []);
  assert.deepEqual(expiredLobbyPlayers(room, RESERVED_GRACE_MS), [p]);
  assert.equal(resumePlayer(room, {}, credentials, RESERVED_GRACE_MS), null);
});
test('race disconnect still transfers host and is not treated as a lobby expiry', () => {
  const { room, socket } = fixture();
  room.phase = 'racing'; room.players.push({ id: 'guest', connected: true });
  disconnectPlayer(room, socket, 0);
  assert.equal(room.host, 'guest');
  assert.deepEqual(expiredLobbyPlayers(room, LOBBY_GRACE_MS), []);
});
test('room credentials survive a reload, remain scoped to the server, and clear on leave', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const session = { code: 'ABC123', playerId: 'host', resumeToken: 'secret-token', mode: 'friends' };
  createRoomSessionStore('https://game.test', () => storage).write(session);
  const reloaded = createRoomSessionStore('https://game.test', () => storage);
  assert.deepEqual(reloaded.read('ABC123'), session);
  assert.deepEqual(reloaded.read(null), session);
  assert.equal(reloaded.read('DEF456'), null, 'another invite must not recover this room');
  assert.equal(createRoomSessionStore('https://other.test', () => storage).read(), null);
  reloaded.clear(); assert.equal(reloaded.read(), null);
});
test('unavailable storage and malformed saved data never prevent using the game', () => {
  const blocked = createRoomSessionStore('test', () => { throw new Error('blocked'); });
  blocked.write({}); blocked.clear(); assert.equal(blocked.read(), null);
  for (const data of ['bad JSON', 'null', '{}', '{"code":"NOPE"}']) {
    const store = createRoomSessionStore('test', () => ({ getItem: () => data }));
    assert.equal(store.read(), null);
  }
});
