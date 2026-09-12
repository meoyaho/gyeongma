// Lane assignment is authoritative on the server and unique within a room.
// The same lane always selects the same illustration on every participant's device.
export const horseAppearances = [
  { id: 'chestnut', label: '밤색 말' },
  { id: 'palomino', label: '황금빛 말' },
  { id: 'black', label: '검은 말' },
  { id: 'white', label: '흰 말' },
  { id: 'pinto', label: '얼룩 말' },
  { id: 'dapple', label: '회색 반점 말' },
  { id: 'roan', label: '장밋빛 말' },
  { id: 'dun', label: '모래빛 말' },
];
export function horseAppearance(lane = 0) {
  const appearance = horseAppearances[Number.isInteger(lane) && lane >= 0 && lane < 8 ? lane : 0];
  const base = import.meta.env?.BASE_URL || '/';
  return { ...appearance, src: `${base}horses/${appearance.id}.png` };
}
