import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

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
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
await page.goto(`${origin}/?room=${joined.code}`);
await expect(page.locator('#invite-banner')).toContainText('2/8명 참가');
await expect(page.locator('#horse-portrait')).toHaveAttribute('src', '/horses/palomino.png');
await expect(page.locator('#horse-number')).toHaveText('2');

await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
await page.getByRole('button', { name: '완료', exact: true }).click();
await expect(page.locator('#name-feedback')).toContainText('같은 이름');
assert.equal(await page.locator('#lobby-dialog').evaluate(dialog => dialog.open), false);

await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('우당탕질주');
await page.getByRole('button', { name: '완료', exact: true }).click();
await expect(page.locator('#lobby-description')).toHaveText('2/8명 참가');
await expect(page.locator('#horse-portrait')).toHaveAttribute('src', '/horses/palomino.png');
await expect(page.locator('#horse-number')).toHaveText('2');
await expect(page.locator('#preview-name')).toHaveText('내 이름은 우당탕질주');
assert.equal(await page.locator('.empty-player').count(), 0);
const bottomGap = await page.evaluate(() => document.documentElement.scrollHeight - (document.querySelector('#lobby-dialog').getBoundingClientRect().bottom + scrollY));
assert.ok(bottomGap >= 40, `mobile lobby bottom gap is ${bottomGap}px`);
await wait(data => data.type === 'state' && data.players.length === 2);
assert.equal(new URL(page.url()).searchParams.get('player'), null, 'participant URL has no reconnect identity');
const sharedUrl = await page.locator('#invite-link').inputValue();
assert.equal(new URL(sharedUrl).searchParams.get('player'), null, 'shared URL excludes the reconnect identity');
const sharedPage = await context.newPage();
await sharedPage.goto(sharedUrl);
await expect(sharedPage.locator('#invite-banner')).toContainText('3/8명 참가');
assert.equal(await sharedPage.locator('#lobby-dialog').evaluate(dialog => dialog.open), false, 'shared URL opens a new participant screen');
await sharedPage.close();
await page.reload();
await expect(page.locator('#invite-banner')).toContainText('2/8명 참가');
assert.equal(await page.locator('#lobby-dialog').evaluate(dialog => dialog.open), false, 'refresh creates a new unnamed participant');
await expect(page.locator('#preview-name')).toHaveText('내 이름은 ???');
await expect(page.locator('#horse-number')).toHaveText('2');
await page.screenshot({ path: 'test-results/invite-guest-mobile.png', fullPage: true });

console.log('Invite reservations use connection order and refresh removes the prior participant');
host.send(JSON.stringify({ type: 'leave' }));
await browser.close();
host.close();
