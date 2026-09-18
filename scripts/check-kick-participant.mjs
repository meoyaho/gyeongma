import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

// Verifies the host can remove a named participant who is stuck/unresponsive
// (e.g. mic permission error), and that the lobby shows connection status as
// a colored dot badge rather than "재접속 대기 중" text.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const host = await browser.newPage({ viewport: { width: 390, height: 844 } });
await host.goto(process.env.TEST_ORIGIN || 'http://localhost:3000');
await host.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
await host.getByRole('button', { name: '확인', exact: true }).click();
await expect(host.getByRole('button', { name: '친구와 달리기', exact: true })).toBeEnabled({ timeout: 35000 });
await host.getByRole('button', { name: '친구와 달리기', exact: true }).click();
await host.locator('#invite-link').waitFor();
const invite = await host.locator('#invite-link').inputValue();

const guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
await guest.goto(invite);
await guest.getByRole('textbox', { name: '말 이름', exact: true }).fill('우당탕질주');
await guest.getByRole('button', { name: '완료', exact: true }).click();
await guest.locator('#lobby-dialog').waitFor({ state: 'visible' });

// Host sees the guest with a green "connected" dot, no "재접속 대기 중" text anywhere.
const guestCard = host.locator('.player-card', { hasText: '우당탕질주' });
await expect(guestCard.locator('.status-dot')).toHaveClass(/is-connected/);
assert.equal(await host.locator('.lobby-players').evaluate(el => el.textContent.includes('재접속 대기 중')), false);

// The host can kick the named guest directly (simulating a stuck/erroring participant).
await expect(guestCard.locator('.kick-button')).toBeVisible();
await guestCard.locator('.kick-button').click();
await expect(host.locator('.player-card', { hasText: '우당탕질주' })).toHaveCount(0, { timeout: 10000 });
console.log('OK: host can kick a stuck named participant, who is removed from the lobby');

// The guest's own client is disconnected/kicked out too.
await expect(guest.locator('#lobby-dialog')).not.toBeVisible({ timeout: 10000 });
console.log('OK: the kicked participant is dropped from the room on their end too');

await browser.close();
