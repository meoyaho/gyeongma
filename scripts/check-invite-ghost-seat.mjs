import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Verifies the desired invite-seat lifecycle:
// - opening the link shows a real "이름 짓는 중" (reserved) seat to the host
// - abandoning it before naming makes that seat disappear quickly (~2s)
// - reopening the link (a "different browser") reserves a fresh seat
// - once a name is confirmed, disconnecting no longer removes the seat
//   (it keeps its 5-minute lobby grace instead, like any named participant)
const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
const wsOrigin = origin.replace(/^http/, 'ws');
const host = new WebSocket(`${wsOrigin}/ws`);
const messages = [];
const waiters = [];
host.on('message', raw => {
  const data = JSON.parse(raw);
  messages.push(data);
  for (const waiter of [...waiters]) waiter(data);
});
const wait = predicate => new Promise((resolve, reject) => {
  const prior = messages.find(predicate);
  if (prior) return resolve(prior);
  const timer = setTimeout(() => reject(new Error('Timed out waiting for room state')), 30000);
  waiters.push(data => { if (!predicate(data)) return; clearTimeout(timer); resolve(data); });
});
await new Promise((resolve, reject) => { host.on('open', resolve); host.on('error', reject); });
host.send(JSON.stringify({ type: 'create', mode: 'friends', name: '바람을따라' }));
const joined = await wait(data => data.type === 'joined');
await wait(data => data.type === 'state' && data.players.length === 1);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const inviteUrl = `${origin}/?room=${joined.code}`;

// 1) A guest opens the link: the host sees a real, unnamed "이름 짓는 중" seat.
const glance = await browser.newPage({ viewport: { width: 390, height: 844 } });
await glance.goto(inviteUrl);
const reservedState = await wait(data => data.type === 'state' && data.players.length === 2);
const ghost = reservedState.players.find(p => p.id !== joined.id);
assert.equal(ghost.reserved, true, 'opening the link reserves a real, visible seat');
assert.equal(ghost.name, '');

// 2) The guest abandons it without ever naming their horse. The seat disappears quickly.
await glance.close();
await wait(data => data.type === 'state' && data.players.length === 1);
console.log('OK: an abandoned "이름 짓는 중" seat disappears once the browser closes');

// 3) The same person reopens the link in a "different browser": a fresh seat is reserved.
const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
await guest.goto(inviteUrl);
const reopenedState = await wait(data => data.type === 'state' && data.players.length === 2);
assert.equal(reopenedState.players.find(p => p.id !== joined.id).reserved, true);
console.log('OK: reopening the link reserves a fresh "이름 짓는 중" seat');

// 4) This time the guest actually names their horse.
await guest.getByRole('textbox', { name: '말 이름', exact: true }).fill('우당탕질주');
await guest.getByRole('button', { name: '완료', exact: true }).click();
const namedState = await wait(data => data.type === 'state' && data.players.some(p => p.name === '우당탕질주'));
const namedGuest = namedState.players.find(p => p.name === '우당탕질주');
assert.equal(namedGuest.reserved, false);

// 5) Once named, closing the browser must NOT remove the seat (unlike the
// unnamed ghost above) — it should still be present, just disconnected.
await guest.close();
await wait(data => data.type === 'state' && data.players.find(p => p.id === namedGuest.id)?.connected === false);
await new Promise(resolve => setTimeout(resolve, 2500)); // past the 2s reserved-only grace
const stillThere = messages.filter(d => d.type === 'state').at(-1);
assert.equal(stillThere.players.some(p => p.id === namedGuest.id), true, 'a named participant is not dropped just because the reserved-seat grace elapsed');
console.log('OK: a named participant survives past the short reserved-seat grace window');

await browser.close();
host.send(JSON.stringify({ type: 'leave' }));
host.close();
