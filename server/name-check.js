import { validateName } from '../shared/rules.js';
import { moderateName } from './name-moderation.js';

export const KRA_NAME_SOURCE = 'https://www.horsepia.com/hp/pa/hh/PAHH2060/index.do';
const KRA_SEARCH_URL = 'https://www.horsepia.com/hp/pa/hh/PAHH2060/search.do';
const unavailable = () => ({ ok: false, code: 'LOOKUP_UNAVAILABLE', message: '마사회 이름 조회를 완료하지 못했습니다. 잠시 후 다시 확인해주세요.' });

// This is the public request used by Horsepia's identical/similar name tabs.
// A similar match alone is not a duplicate. A retired/deceased exact match is.
export function parseKraNames(data, name) {
  if (!data || !Array.isArray(data.HoHrHrnmLimList)) throw new Error('Unexpected KRA response');
  for (const row of data.HoHrHrnmLimList) {
    if (!row || typeof row.korHrnm !== 'string') throw new Error('Invalid KRA name record');
  }
  const records = data.HoHrHrnmLimList.filter(row => row.korHrnm.normalize('NFC').trim() === name);
  if (records.some(row => typeof row.hrno === 'string' && /^\d+$/.test(row.hrno))) {
    return { ok: false, code: 'EXISTING_HORSE', message: '마사회에 등록된 기존 말 이름입니다. 다른 이름을 입력해주세요.' };
  }
  if (records.length) return { ok: false, code: 'KRA_RESTRICTED', message: '마사회에서 사용을 제한한 이름입니다. 다른 이름을 입력해주세요.' };
  return { ok: true };
}

export function createNameChecker({ fetchImpl = fetch, moderate = moderateName, now = Date.now, allowedTtl = 5 * 60_000, blockedTtl = 24 * 60 * 60_000, maxCache = 5000, maxConcurrent = 6 } = {}) {
  const cache = new Map(), pending = new Map();
  async function lookup(name) {
    const decision = await moderate(name);
    if (!decision.ok) return decision;
    // Query both the identical-name restriction list and the historical
    // similar-name list: names may become reusable under KRA's own time rules,
    // while this game rejects any exact registered name returned by the source.
    for (const gubun of ['1', '2']) {
      const response = await fetchImpl(KRA_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams({ searchWord: name, gubun }),
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(`KRA HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('Oversized KRA response');
      const result = parseKraNames(JSON.parse(text), name);
      if (!result.ok) return result;
    }
    return { ok: true, code: 'AVAILABLE', message: '사용 가능한 이름입니다.' };
  }
  return async function checkName(name) {
    const local = validateName(name);
    if (!local.ok) return { ...local, code: 'NAME_RESTRICTED' };
    const hit = cache.get(name);
    if (hit && hit.expires > now()) return hit.result;
    if (pending.has(name)) return pending.get(name);
    if (pending.size >= maxConcurrent) return unavailable();
    const operation = lookup(name).then(result => {
      if (['AI_UNAVAILABLE', 'AI_NOT_CONFIGURED'].includes(result.code)) return result;
      const checked = { ...result, ...(!result.code?.startsWith('AI_') ? { source: KRA_NAME_SOURCE } : {}), checkedAt: new Date(now()).toISOString() };
      if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
      cache.set(name, { result: checked, expires: now() + (result.ok ? allowedTtl : blockedTtl) });
      return checked;
    }).catch(() => unavailable()).finally(() => pending.delete(name));
    pending.set(name, operation);
    return operation;
  };
}

export const checkName = createNameChecker();
