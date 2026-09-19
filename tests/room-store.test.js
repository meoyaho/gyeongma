import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneStaleRooms } from '../server/room-store.js';

test('prunes only rooms older than the max age, and rooms missing a createdAt', async () => {
  const deleted = [];
  const all = {
    FFFFF1: { code: 'FFFFF1', createdAt: 1000 },
    '000001': { code: '000001', createdAt: 0 },
    '000002': {},
  };
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'DELETE') { deleted.push(url); return { ok: true, status: 204 }; }
    return { ok: true, json: async () => all };
  };
  const removed = await pruneStaleRooms(1000, { fetchImpl, now: () => 2000 });
  assert.equal(removed, 2);
  assert.equal(deleted.some(url => url.includes('000001')), true);
  assert.equal(deleted.some(url => url.includes('000002')), true);
  assert.equal(deleted.some(url => url.includes('FFFFF1')), false);
});
test('an empty or missing collection prunes nothing', async () => {
  for (const body of [null, {}]) {
    const fetchImpl = async () => ({ ok: true, json: async () => body });
    assert.equal(await pruneStaleRooms(1000, { fetchImpl }), 0);
  }
});
test('a listing failure is logged and does not throw', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  assert.equal(await pruneStaleRooms(1000, { fetchImpl }), 0);
});
test('a failed delete for one stale room does not stop the others', async () => {
  const deleted = [];
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'DELETE') {
      if (url.includes('BAD001')) throw new Error('network blip');
      deleted.push(url);
      return { ok: true, status: 204 };
    }
    return { ok: true, json: async () => ({ BAD001: { createdAt: 0 }, '000003': { createdAt: 0 } }) };
  };
  const removed = await pruneStaleRooms(1000, { fetchImpl, now: () => 2000 });
  assert.equal(removed, 2);
  assert.equal(deleted.some(url => url.includes('000003')), true);
});
