export const horseAppearances = [
  ...Array.from({ length: 8 }, (_, index) => ({ id: `horse${index + 1}`, label: `말 캐릭터 ${index + 1}` })),
];
export function horseAppearance(index = 0) {
  const appearance = horseAppearances[Number.isInteger(index) && index >= 0 && index < 8 ? index : 0];
  const base = import.meta.env?.BASE_URL || '/';
  return { ...appearance, src: `${base}horses/${appearance.id}.png` };
}
