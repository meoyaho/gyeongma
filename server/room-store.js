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
