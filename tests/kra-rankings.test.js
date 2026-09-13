import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKraRankingHtml } from '../server/kra-rankings.js';

test('reads the first seven unique 4–6 character Korean horse names in ranking order', () => {
  const rows = ['로쉬', '라온사일런스', '서클에이', '로열삭스', '글로벌챔프', '라온플로렌스', '제너럴윈드', '한센브레이싱']
    .map((name, index) => `<tr><td>${index + 1}</td><td><a href="javascript:goPage3('00${index}')">${name}</a></td></tr>`)
    .join('');
  assert.deepEqual(parseKraRankingHtml(`<table>${rows}</table>`), ['라온사일런스', '서클에이', '로열삭스', '글로벌챔프', '라온플로렌스', '제너럴윈드', '한센브레이싱']);
});

test('rejects an incomplete or changed ranking response', () => {
  assert.throws(() => parseKraRankingHtml('<html>점검 중</html>'), /7두/);
});
