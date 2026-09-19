const DATABASE_URL = (process.env.FIREBASE_DATABASE_URL || 'https://horse-name-default-rtdb.firebaseio.com').replace(/\/$/, '');
const CODE = /^[A-F0-9]{6}$/;

function url(code) {
  if (!CODE.test(code)) throw new Error('Invalid room code');
  return `${DATABASE_URL}/rooms/${code}.json`;
}

async function request(code, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url(code), { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Firebase room store returned ${response.status}`);
    return response.status === 204 ? null : response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveRoom(room) {
  if (room.mode !== 'friends' || room.phase !== 'lobby') return;
  const data = {
    code: room.code,
    mode: room.mode,
    phase: room.phase,
    host: room.host,
    createdAt: room.createdAt,
    players: room.players.filter(player => !player.bot).map(player => ({
      id: player.id,
      resumeHash: player.resumeHash,
      name: player.name,
      lane: player.lane,
      appearance: player.appearance,
      ready: player.ready,
    })),
  };
  await request(room.code, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteRoom(code) {
  await request(String(code || '').trim().toUpperCase(), { method: 'DELETE' });
}

// A room this server created is deleted here the moment it starts, empties,
// or hits the 30-minute cap — but that only runs while THIS process is alive
// to see it happen. A crash or redeploy mid-lobby orphans that room's entry
// in Firebase forever, since nothing else ever reads or expires it. Sweep
// the whole collection independently of any in-memory room state so those
// leftovers still get cleaned up once this (or the next) process is running.
export async function pruneStaleRooms(maxAgeMs, { fetchImpl = fetch, now = Date.now } = {}) {
  let all;
  try {
    const response = await fetchImpl(`${DATABASE_URL}/rooms.json`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Firebase room store returned ${response.status}`);
    all = await response.json();
  } catch (error) {
    console.error('Firebase stale room listing failed:', error.message);
    return 0;
  }
  if (!all || typeof all !== 'object') return 0;
  const stale = Object.entries(all)
    .filter(([, room]) => !room || typeof room.createdAt !== 'number' || now() - room.createdAt > maxAgeMs)
    .map(([code]) => code);
  await Promise.all(stale.map(async code => {
    try { await fetchImpl(url(code), { method: 'DELETE', signal: AbortSignal.timeout(5000) }); }
    catch (error) { console.error('Firebase stale room delete failed:', error.message); }
  }));
  return stale.length;
}
