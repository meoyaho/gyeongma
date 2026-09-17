import { createHash } from 'node:crypto';

export const LOBBY_GRACE_MS = 5 * 60_000;
// A reserved seat has no name yet, so a different browser opening the same
// invite link (e.g. closing a KakaoTalk in-app browser and reopening in
// Safari) can't resume it — it just reserves a second seat instead. Keeping
// the abandoned one around for the full 5 minutes then blocks "start" on a
// phantom, disconnected seat, so it gets a much shorter grace window.
export const RESERVED_GRACE_MS = 15_000;
export function resumeHash(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}
function graceMsFor(p) {
  return p.reserved ? RESERVED_GRACE_MS : LOBBY_GRACE_MS;
}

export function disconnectPlayer(room, ws, now = Date.now()) {
  const p = room.players.find(player => player.id === ws.playerId);
  if (!p || p.ws !== ws) return false;
  p.connected = false; p.ws = null; p.calls = []; p.speed = 0;
  if (room.phase === 'lobby') {
    p.disconnectedAt = now;
    p.ready = false;
    // Sharing an invite is temporary: retain the host until explicit leave/expiry.
  } else if (room.host === p.id) {
    const live = room.players.find(other => !other.bot && other.connected);
    if (live) room.host = live.id;
  }
  return true;
}

export function resumePlayer(room, ws, msg, now = Date.now()) {
  const p = room?.players.find(player => player.id === msg.playerId);
  if (!p?.resumeHash || typeof msg.resumeToken !== 'string' || p.resumeHash !== resumeHash(msg.resumeToken)) return null;
  if (room.phase === 'lobby' && !p.connected && now - p.disconnectedAt >= graceMsFor(p)) return null;
  const old = p.ws;
  // A suspended mobile socket may still look OPEN on the server. Authenticate
  // first, then replace it; its delayed close must not detach the new connection.
  p.ws = ws; p.connected = true; delete p.disconnectedAt;
  if (room.phase === 'lobby') p.ready = false;
  ws.roomCode = room.code; ws.playerId = p.id;
  if (old && old !== ws) {
    old.roomCode = null;
    old.joinGeneration = (old.joinGeneration || 0) + 1;
    old.pendingJoin = false;
    old.close(4001, 'Session resumed elsewhere');
  }
  return p;
}

export function expiredLobbyPlayers(room, now = Date.now()) {
  if (room.phase !== 'lobby') return [];
  return room.players.filter(p => !p.bot && !p.connected && p.disconnectedAt != null && now - p.disconnectedAt >= graceMsFor(p));
}
