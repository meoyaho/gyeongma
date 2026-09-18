import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Opening an invite link (e.g. from KakaoTalk's in-app browser, then bouncing
// to a real browser) must never occupy a room seat by itself — only actually
// completing a name does. This guards against the "이름 짓는 중" ghost seat
// that used to appear whenever someone opened and abandoned the link.
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
  waiters.push(data => {
    if (!predicate(data)) return;
    clearTimeout(timer);
    resolve(data);
  });
});
await new Promise((resolve, reject) => {
  host.on('open', resolve);
  host.on('error', reject);
});
host.send(JSON.stringify({ type: 'create', mode: 'friends', name: '바람을따라' }));
const joined = await wait(data => data.type === 'joined');
await wait(data => data.type === 'state' && data.players.length === 1);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const inviteUrl = `${origin}/?room=${joined.code}`;

// A guest opens the link but abandons it without ever naming their horse
// (e.g. glanced at it in KakaoTalk's in-app browser and closed the tab).
const glance = await browser.newPage({ viewport: { width: 390, height: 844 } });
await glance.goto(inviteUrl);
await expect(glance.locator('#invite-banner')).toContainText('1/8명 참가');
await glance.close();
await new Promise(resolve => setTimeout(resolve, 300));

// The same person reopens the link in a different browser. This must show
// the same "1/8명 참가", not "2/8명" from a leftover reserved ghost.
const guest = await browser.newContext({ viewport: { width: 390, height: 844 } }).then(c => c.newPage());
await guest.goto(inviteUrl);
await expect(guest.locator('#invite-banner')).toContainText('1/8명 참가');
await guest.getByRole('textbox', { name: '말 이름', exact: true }).fill('우당탕질주');
await guest.getByRole('button', { name: '완료', exact: true }).click();
await expect(guest.locator('#lobby-dialog')).toBeVisible({ timeout: 35000 });
await expect(guest.locator('#preview-name')).toHaveText('내 이름은 우당탕질주');
const full = await wait(data => data.type === 'state' && data.players.length === 2);
assert.equal(full.players.every(p => !p.reserved), true, 'no player was ever a nameless reserved ghost');

// The whole session never saw a room grow past the two real participants,
// even transiently, from the abandoned open.
assert.equal(Math.max(...messages.filter(d => d.type === 'state').map(d => d.players.length)), 2);
console.log('OK: opening and abandoning an invite link never reserves a ghost seat');

await guest.close();
await browser.close();
host.send(JSON.stringify({ type: 'leave' }));
host.close();
