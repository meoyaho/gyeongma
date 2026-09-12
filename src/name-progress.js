// Rebuild from the browser's current hypothesis, rather than accumulating
// interim strings. Revisions and repeated starts can therefore move backwards.
export function analyzeNameProgress(text, name) {
  if (!name) return { count: 0, progress: 0 };
  let count = 0, progress = 0;
  for (const char of text.replace(/[^가-힣]/g, '')) {
    const candidate = name.slice(0, progress) + char;
    progress = Math.min(name.length, candidate.length);
    while (progress && !candidate.endsWith(name.slice(0, progress))) progress--;
    if (progress === name.length) { count++; progress = 0; }
  }
  return { count, progress };
}
