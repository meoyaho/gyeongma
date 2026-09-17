// Only structural checks run locally. Semantic moderation is server-side.
export const suggestions = ['말이되냐','말로하자','울트라걸','내가간다','장난아냐','당근좋아','바람난다'];
// Names like "지수네말" are often misheard by speech recognition as "지수의
// 말" (formal possessive), because that reading is grammatical Korean and
// "-네 + common noun" is not. Block that structural pattern so registered
// names stay recognizable — this is about recognizability, not semantic
// moderation, so it doesn't overlap with the server-side denylist-free check.
const NOUNS_AFTER_NE = ['말','집','밥','옷','손','발','눈','코','입','몸','맘','꿈','길','물','불','돈','땅','산','강','바다','하늘','구름','바람','소리','노래','이름','사랑','친구','가족','마음','나라','세상','인생','생각','얼굴','머리','다리','나무','오늘','내일','어제','아침','저녁'];
export function validateName(name) {
  if (typeof name !== 'string' || !name) return { ok: false, message: '말 이름을 입력해주세요.' };
  if (/\s/.test(name)) return { ok: false, message: '띄어쓰기는 사용할 수 없습니다.' };
  if (/[0-9]/.test(name)) return { ok: false, message: '숫자는 사용할 수 없습니다.' };
  if (/[a-z]/i.test(name)) return { ok: false, message: '영문은 사용할 수 없습니다.' };
  if (/[ㄱ-ㅣ\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/.test(name)) return { ok: false, message: '자음·모음만 사용할 수 없습니다. 완성된 한글로 입력해주세요.' };
  if (!/^[가-힣]+$/.test(name)) return { ok: false, message: '한글 외 문자와 기호는 사용할 수 없습니다.' };
  if (name.length < 4 || name.length > 6) return { ok: false, message: '말 이름은 4~6글자로 입력해주세요.' };
  for (let index = 1; index < name.length; index++) {
    if (name[index] === '네' && NOUNS_AFTER_NE.includes(name.slice(index + 1))) {
      return { ok: false, message: '음성 인식이 헷갈릴 수 있는 이름이에요. 다른 이름을 입력해주세요.' };
    }
  }
  return { ok: true, message: '이름 형식이 확인되었습니다.' };
}
export const RACE_DISTANCE = 200;
export const MIN_SPEED = 5;
export const MAX_SPEED = 20;
export const BOOST_WINDOW = 2000;
export function speedForCalls(calls, now) {
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(1, calls.filter(t => now - t < BOOST_WINDOW && now >= t).length / 4);
}
