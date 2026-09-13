// Rebuild from the browser's current hypothesis, rather than accumulating
// interim strings. Revisions and repeated starts can therefore move backwards.
const CHOSEONG_TO_JONGSEONG = new Map([
  [0, 1], [1, 2], [2, 4], [3, 7], [5, 8], [6, 16], [7, 17],
  [9, 19], [10, 20], [12, 22], [14, 23], [15, 24], [16, 25], [17, 26], [18, 27],
]);

// Speech recognition often writes a liaison sound in its standard spelling:
// 주겨 → 죽여. Canonicalize both forms without allowing arbitrary typos.
export function normalizeKoreanPronunciation(value) {
  const syllables = [...value.replace(/[^가-힣]/g, '')].map(char => char.charCodeAt(0) - 0xac00);
  for (let index = 1; index < syllables.length; index++) {
    const previous = syllables[index - 1];
    const current = syllables[index];
    const previousJongseong = previous % 28;
    const currentChoseong = Math.floor(current / 588);
    const movedJongseong = CHOSEONG_TO_JONGSEONG.get(currentChoseong);
    if (previousJongseong || !movedJongseong || currentChoseong === 11) continue;
    syllables[index - 1] = previous + movedJongseong;
    syllables[index] = current + (11 - currentChoseong) * 588;
  }
  return syllables.map(code => String.fromCharCode(code + 0xac00)).join('');
}

function liaisonVariants(name) {
  let variants = new Set([name]);
  for (let index = 1; index < name.length; index++) {
    for (const variant of [...variants]) {
      const previous = variant.charCodeAt(index - 1) - 0xac00;
      const current = variant.charCodeAt(index) - 0xac00;
      const movedJongseong = CHOSEONG_TO_JONGSEONG.get(Math.floor(current / 588));
      if (previous % 28 || !movedJongseong) continue;
      const shifted = [...variant];
      shifted[index - 1] = String.fromCharCode(0xac00 + previous + movedJongseong);
      shifted[index] = String.fromCharCode(0xac00 + current + (11 - Math.floor(current / 588)) * 588);
      variants.add(shifted.join(''));
    }
  }
  return variants;
}

function analyzeExact(text, name) {
  let count = 0, progress = 0;
  for (const char of text) {
    const candidate = name.slice(0, progress) + char;
    progress = Math.min(name.length, candidate.length);
    while (progress && !candidate.endsWith(name.slice(0, progress))) progress--;
    if (progress === name.length) { count++; progress = 0; }
  }
  return { count, progress };
}

export function analyzeNameProgress(text, name) {
  if (!name) return { count: 0, progress: 0 };
  const spokenText = text.replace(/[^가-힣]/g, '');
  let best = { count: 0, progress: 0 };
  for (const variant of liaisonVariants(name)) {
    const result = analyzeExact(spokenText, variant);
    if (result.count > best.count || result.count === best.count && result.progress > best.progress) best = result;
  }
  return best;
}
