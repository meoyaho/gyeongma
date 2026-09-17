import test from 'node:test';
import assert from 'node:assert/strict';
import { validateName, suggestions, speedForCalls, MIN_SPEED, MAX_SPEED, RACE_DISTANCE } from '../shared/rules.js';

test('accepts complete Hangul names of 4–6 syllables', () => {
  for (const name of [...suggestions, '한글네자', '한글여섯글자']) assert.equal(validateName(name).ok, true, name);
});
test('rejects length, whitespace, latin, numbers, jamo and punctuation', () => {
  for (const name of ['', null, 1234, '말이름', '일이삼사오육칠', '바람 따라', '바람따라 ', '  바람따라', '바람\n따라', '가나다ㄹ', 'ㄱㄴㄷㄹ', 'ㅏㅑㅓㅕ', '바람12', '바람wind', '바람따라!', '바람따라🐎', '바람\u200b따라']) assert.equal(validateName(name).ok, false, String(name));
});
test('semantic decisions are deferred to the server, without a local denylist', () => {
  for (const name of ['유재석질주', '삼성전자', '하하하하']) assert.equal(validateName(name).ok, true);
});
test('rejects "네" immediately followed by a common noun, likely to be misheard as "의"', () => {
  for (const name of ['지수네말', '우리집앞네집', '준서네나무']) assert.equal(validateName(name).ok, false, name);
});
test('allows "네" when it is not followed by a recognized noun, or is the first syllable', () => {
  for (const name of ['네잎클로버', '지수네달려', '바람둥이네']) assert.equal(validateName(name).ok, true, name);
});
test('silence has minimum speed; 4 repeats in two seconds have maximum speed', () => {
  assert.equal(speedForCalls([], 10000), MIN_SPEED);
  assert.equal(speedForCalls([9950], 10000), 8.75);
  assert.equal(speedForCalls([8500, 9000, 9500, 9999], 10000), MAX_SPEED);
  assert.equal(speedForCalls(Array(100).fill(9000), 10000), MAX_SPEED);
  assert.equal(speedForCalls([7000, 8000, 11000], 10000), MIN_SPEED);
  assert.equal(RACE_DISTANCE / MAX_SPEED, 10);
  assert.equal(RACE_DISTANCE / MIN_SPEED, 40);
});
