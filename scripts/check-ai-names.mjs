// Opt-in live evaluation. These examples are test cases, never production filters.
import '../server/env.js';
import { createNameModerator } from '../server/name-moderation.js';
let inputTokens = 0, outputTokens = 0;
const check = createNameModerator({ fetchImpl: async (...args) => {
  const res = await fetch(...args);
  if (res.ok) {
    const data = await res.clone().json();
    inputTokens += data.usage?.input_tokens || 0; outputTokens += data.usage?.output_tokens || 0;
  }
  return res;
} });
const cases = [
  ['유재석질주', 'AI_FAMOUS'], ['이준석질주', 'AI_FAMOUS'], ['손흥민달려', 'AI_FAMOUS'],
  ['삼성전자', 'AI_COMMERCIAL'], ['무료배송', 'AI_COMMERCIAL'], ['이케아최고', 'AI_COMMERCIAL'],
  ['시발경주', 'AI_INAPPROPRIATE'], ['개새끼말', 'AI_INAPPROPRIATE'],
  ['바람을따라', 'AI_ALLOWED'], ['하하하하', 'AI_ALLOWED'], ['당근이좋아', 'AI_ALLOWED'], ['우당탕질주', 'AI_ALLOWED'],
];
let exact = 0, safeDecisions = 0;
for (let i = 0; i < cases.length; i += 2) {
  for (const { name, expected, result } of await Promise.all(cases.slice(i, i + 2).map(async ([name, expected]) => ({ name, expected, result: await check(name) })))) {
    console.log(`${name}: ${result.code} (expected ${expected})`);
    if (result.code === expected) exact++;
    if (result.ok === (expected === 'AI_ALLOWED') && !['AI_UNAVAILABLE', 'AI_NOT_CONFIGURED'].includes(result.code)) safeDecisions++;
  }
}
console.log(JSON.stringify({ exactCategories: `${exact}/${cases.length}`, correctAllowBlock: `${safeDecisions}/${cases.length}`, inputTokens, outputTokens, estimatedUSD: (inputTokens * .05 + outputTokens * .40) / 1_000_000 }));
if (safeDecisions !== cases.length) process.exitCode = 1;
