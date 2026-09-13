const RANKING_URL = 'https://race.kra.co.kr/racehorse/scoreRecent50Object.do';
const FALLBACK_NAMES = ['로쉬', '라온사일런스', '서클에이', '로열삭스', '글로벌챔프', '라온플로렌스', '제너럴윈드'];

let cachedDate = '';
let cachedNames = FALLBACK_NAMES;
let pendingRefresh = null;

const koreaDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export function parseKraRankingHtml(html) {
  const names = [];
  const horseLink = /<a\s+[^>]*href=["']javascript:goPage3\('[^']+'\)["'][^>]*>([^<]+)<\/a>/gi;
  for (const match of html.matchAll(horseLink)) {
    const name = match[1].replace(/&nbsp;/gi, ' ').trim();
    if (/^[가-힣]+$/.test(name) && !names.includes(name)) names.push(name);
    if (names.length === 7) break;
  }
  if (names.length !== 7) throw new Error('한국마사회 순위표에서 경주마 7두를 찾지 못했습니다.');
  return names;
}

async function refreshRankings() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RANKING_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'horse-name-game/1.0' },
    });
    if (!response.ok) throw new Error(`한국마사회 순위 요청 실패: ${response.status}`);
    const html = new TextDecoder('euc-kr').decode(await response.arrayBuffer());
    cachedNames = parseKraRankingHtml(html);
    cachedDate = koreaDate();
  } catch (error) {
    console.warn('한국마사회 경주마 순위를 갱신하지 못해 최근 목록을 사용합니다.', error.message);
    cachedDate = koreaDate();
  } finally {
    clearTimeout(timeout);
    pendingRefresh = null;
  }
  return cachedNames;
}

export function getRankedAiHorseNames() {
  if (cachedDate === koreaDate()) return Promise.resolve(cachedNames);
  pendingRefresh ||= refreshRankings();
  return pendingRefresh;
}
