import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameModerator, parseNameDecision, NAME_MODEL } from '../server/name-moderation.js';
const payload = category => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ reference: '', category }) }] }] });

test('all AI categories map to server-owned decisions and warnings', () => {
  assert.equal(parseNameDecision(payload('allowed')).ok, true);
  for (const category of ['famous', 'commercial', 'inappropriate', 'uncertain']) {
    const result = parseNameDecision(payload(category));
    assert.equal(result.ok, false); assert.equal(result.code, `AI_${category.toUpperCase()}`); assert.ok(result.message);
  }
});
test('refusal, truncated JSON, incomplete response and unknown categories fail closed', () => {
  for (const data of [null, { ...payload('allowed'), status: 'incomplete' }, payload('unknown'),
    { status: 'completed', output: [] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] },
  ]) assert.throws(() => parseNameDecision(data));
});
test('missing key never sends a request; upstream errors do not leak secrets and can retry', async () => {
  let calls = 0;
  const missing = createNameModerator({ apiKey: '', fetchImpl: async () => { calls++; } });
  assert.equal((await missing('바람을따라')).code, 'AI_NOT_CONFIGURED'); assert.equal(calls, 0);
  const failed = createNameModerator({ apiKey: 'test-secret', fetchImpl: async () => { calls++; throw new Error('test-secret'); } });
  assert.equal((await failed('바람을따라')).code, 'AI_UNAVAILABLE');
  assert.equal(JSON.stringify(await failed('바람을따라')).includes('test-secret'), false); assert.equal(calls, 2);
});
test('uses the budget model, a strict schema, separate untrusted input, and caches/deduplicates decisions', async () => {
  let calls = 0, time = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const check = createNameModerator({ apiKey: 'test-secret', now: () => time, cacheTtl: 100, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.model, NAME_MODEL); assert.equal(body.model, 'gpt-5-nano'); assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true); assert.equal(body.text.format.schema.additionalProperties, false);
    assert.equal(body.input[0].role, 'user'); assert.deepEqual(JSON.parse(body.input[0].content), { name: '바람을따라' });
    assert.equal(body.instructions.includes('바람을따라'), false);
    assert.equal(body.tools, undefined); assert.ok(body.max_output_tokens <= 1024);
    await gate; return { ok: true, json: async () => payload('allowed') };
  } });
  const a = check('바람을따라'), b = check('바람을따라'); release();
  assert.deepEqual(await a, await b); assert.equal(calls, 1);
  await check('바람을따라'); assert.equal(calls, 1);
  time = 101; await check('바람을따라'); assert.equal(calls, 2);
});
