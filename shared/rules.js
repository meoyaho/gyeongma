// Only structural checks run locally. Semantic moderation is server-side.
export const suggestions = ['바람을따라','우당탕질주','구름콩콩이','당근이좋아','새벽콩콩이','천둥발굽','달빛을달려'];
export function validateName(name) {
  if (typeof name !== 'string' || !name) return { ok: false, message: '말 이름을 입력해주세요.' };
  if (/\s/.test(name)) return { ok: false, message: '띄어쓰기는 사용할 수 없습니다.' };
  if (/[0-9]/.test(name)) return { ok: false, message: '숫자는 사용할 수 없습니다.' };
  if (/[a-z]/i.test(name)) return { ok: false, message: '영문은 사용할 수 없습니다.' };
  if (/[ㄱ-ㅣ\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/.test(name)) return { ok: false, message: '자음·모음만 사용할 수 없습니다. 완성된 한글로 입력해주세요.' };
  if (!/^[가-힣]+$/.test(name)) return { ok: false, message: '한글 외 문자와 기호는 사용할 수 없습니다.' };
  if (name.length < 4 || name.length > 6) return { ok: false, message: '말 이름은 4~6글자로 입력해주세요.' };
  return { ok: true, message: '이름 형식이 확인되었습니다.' };
}
export const RACE_DISTANCE = 200;
export const MIN_SPEED = 5;
export const MAX_SPEED = 20;
export const BOOST_WINDOW = 2000;
export function speedForCalls(calls, now) {
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.min(1, calls.filter(t => now - t < BOOST_WINDOW && now >= t).length / 4);
}
