import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameChecker, parseKraNames } from '../server/name-check.js';

const createChecker = options => createNameChecker({ moderate: async () => ({ ok: true }), ...options });
const response = rows => ({ ok: true, text: async () => JSON.stringify({ HoHrHrnmLimList: rows }) });

test('blocks exact registered names even after retirement, but permits similar-only matches', () => {
  const retired = { korHrnm: '트리플나인', hrno: '0032258', rchrRegCnclDt: '2020-09-02', inq: '사용가능' };
  assert.equal(parseKraNames({ HoHrHrnmLimList: [retired] }, '트리플나인').code, 'EXISTING_HORSE');
  assert.equal(parseKraNames({ HoHrHrnmLimList: [{ korHrnm: '바람을따라가', hrno: '1234567' }] }, '바람을따라').ok, true);
  assert.equal(parseKraNames({ HoHrHrnmLimList: [{ korHrnm: '이름제한', hrno: null }] }, '이름제한').code, 'KRA_RESTRICTED');
});

test('requires both KRA lists to pass and checks historical exact matches', async () => {
  const requests = [];
  const check = createChecker({ fetchImpl: async (_url, options) => {
    requests.push([options.body.get('searchWord'), options.body.get('gubun')]);
    return response(options.body.get('gubun') === '2' ? [{ korHrnm: '트리플나인', hrno: '0032258' }] : []);
  } });
  assert.equal((await check('트리플나인')).code, 'EXISTING_HORSE');
  assert.deepEqual(requests, [['트리플나인', '1'], ['트리플나인', '2']]);
});

test('invalid format fails before paid moderation or registry requests', async () => {
  let calls = 0;
  const check = createChecker({ moderate: async () => { calls++; return { ok: true }; }, fetchImpl: async () => { calls++; return response([]); } });
  for (const name of ['말', '영어name', '가나다123', 'ㄱㄴㄷㄹ', '바람 따라']) assert.equal((await check(name)).ok, false);
  assert.equal(calls, 0);
});
test('AI rejections stop registry lookup; unavailable AI is never cached as approval', async () => {
  let calls = 0, moderationCalls = 0;
  const check = createChecker({ moderate: async () => { moderationCalls++; return { ok: false, code: 'AI_UNAVAILABLE' }; }, fetchImpl: async () => { calls++; return response([]); } });
  assert.equal((await check('바람을따라')).code, 'AI_UNAVAILABLE');
  assert.equal((await check('바람을따라')).ok, false);
  assert.equal(moderationCalls, 2); assert.equal(calls, 0);
  const rejected = createChecker({ moderate: async () => ({ ok: false, code: 'AI_FAMOUS' }), fetchImpl: async () => { calls++; return response([]); } });
  assert.equal((await rejected('유재석질주')).code, 'AI_FAMOUS'); assert.equal(calls, 0);
});

test('network failures, bad JSON, malformed records and HTTP errors never approve names', async () => {
  for (const fail of [
    async () => { throw new Error('network'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, text: async () => '<html>unavailable</html>' }),
    async () => ({ ok: true, text: async () => '{}' }),
    async () => response([{ hrno: '1234567' }]),
  ]) {
    let calls = 0;
    const check = createChecker({ fetchImpl: async (...args) => { calls++; return fail(...args); } });
    assert.equal((await check('바람을따라')).code, 'LOOKUP_UNAVAILABLE');
    assert.equal((await check('바람을따라')).ok, false);
    assert.equal(calls, 2, 'failed lookups must be retryable, not cached');
  }
  let calls = 0;
  const partial = createChecker({ fetchImpl: async () => ++calls % 2 ? response([]) : { ok: false, status: 503 } });
  assert.equal((await partial('바람을따라')).ok, false, 'a successful first list is insufficient');
});

test('deduplicates pending lookups, caches success briefly, and rechecks after expiry', async () => {
  let time = 0, calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const check = createChecker({ now: () => time, allowedTtl: 100, fetchImpl: async () => { calls++; await gate; return response([]); } });
  const first = check('바람을따라'), second = check('바람을따라');
  await Promise.resolve(); // The moderation stage resolves before the registry request.
  assert.equal(calls, 1);
  release();
  assert.equal((await first).ok, true);
  assert.deepEqual(await first, await second);
  assert.equal(calls, 2);
  assert.equal((await check('바람을따라')).ok, true);
  assert.equal(calls, 2);
  time = 101;
  await check('바람을따라');
  assert.equal(calls, 4);
});

test('excess distinct requests fail closed without cancelling an active lookup', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const check = createChecker({ maxConcurrent: 1, fetchImpl: async () => { await gate; return response([]); } });
  const first = check('바람을따라');
  assert.equal((await check('천둥발굽')).code, 'LOOKUP_UNAVAILABLE');
  release();
  assert.equal((await first).ok, true);
});
