import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNameProgress } from '../src/name-progress.js';

test('colors only the matching prefix and counts complete non-overlapping names', () => {
  const name = '바람을따라';
  assert.deepEqual(analyzeNameProgress('바람을', name), { count: 0, progress: 3 });
  assert.deepEqual(analyzeNameProgress('바람을 따라', name), { count: 1, progress: 0 });
  assert.deepEqual(analyzeNameProgress('바람을따라 바람을따라 바람', name), { count: 2, progress: 2 });
  assert.deepEqual(analyzeNameProgress('다른 말을 하는 중', name), { count: 0, progress: 0 });
});
test('repeated starts and revised hypotheses reset partial highlighting without a boost', () => {
  const name = '바람을따라';
  assert.deepEqual(analyzeNameProgress('바람을 바', name), { count: 0, progress: 1 });
  assert.deepEqual(analyzeNameProgress('바람을 바람을따라', name), { count: 1, progress: 0 });
  assert.deepEqual(analyzeNameProgress('바', name), { count: 0, progress: 1 });
  assert.deepEqual(analyzeNameProgress('바람을 엉뚱한 말', name), { count: 0, progress: 0 });
});
test('names with repeated syllables do not count overlapping matches', () => {
  assert.deepEqual(analyzeNameProgress('하하하하하하', '하하하하'), { count: 1, progress: 2 });
  assert.deepEqual(analyzeNameProgress('바람바바람바람', '바람바람'), { count: 1, progress: 0 });
});
