import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_ORIGIN || 'http://localhost:3000');
  await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '혼자 달리기', exact: true })).toBeEnabled({ timeout: 35000 });
  const preview = await page.locator('#horse-portrait').getAttribute('src');
  await page.getByRole('button', { name: '친구와 달리기', exact: true }).click();
  await expect(page.locator('#lobby-dialog')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('#horse-portrait')).toHaveAttribute('src', preview);
  await expect(page.locator('#lobby-players .player-avatar img')).toHaveAttribute('src', preview);
  console.log('PASS: initial preview, friends lobby portrait, and player card match');

  const guest = await browser.newPage();
  await guest.goto(await page.locator('#invite-link').inputValue());
  // Opening the link alone reserves nothing, so there is no distinct horse to show yet.
  await expect(guest.locator('#invite-banner')).toContainText('1/8명 참가', { timeout: 35000 });
  await guest.getByRole('textbox', { name: '말 이름', exact: true }).fill('우당탕질주');
  await guest.getByRole('button', { name: '완료', exact: true }).click();
  await expect(guest.locator('#lobby-dialog')).toBeVisible({ timeout: 35000 });
  const guestPreview = await guest.locator('#horse-portrait').getAttribute('src');
  assert.notEqual(guestPreview, preview);
  await expect(page.locator('#horse-portrait')).toHaveAttribute('src', preview);
  console.log('PASS: invited guest receives a distinct horse once joined; host stays unchanged');
  await guest.close();

  await page.goto(process.env.TEST_ORIGIN || 'http://localhost:3000');
  await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '혼자 달리기', exact: true })).toBeEnabled({ timeout: 35000 });
  const nextPreview = await page.locator('#horse-portrait').getAttribute('src');
  await page.getByRole('button', { name: '혼자 달리기', exact: true }).click();
  await expect(page.locator('#lobby-dialog')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('#horse-portrait')).toHaveAttribute('src', nextPreview);
  await expect(page.locator('#lobby-players .player-avatar img')).toHaveAttribute('src', nextPreview);
  console.log('PASS: solo room keeps the preview horse');
  await page.getByRole('button', { name: '키보드로 체험', exact: false }).click();
  await page.getByRole('button', { name: '경주 시작하기', exact: false }).click();
  await page.getByRole('button', { name: '← 나가기', exact: true }).click();
  const returnPreview = await page.locator('#horse-portrait').getAttribute('src');
  await page.getByRole('button', { name: '혼자 달리기', exact: true }).click();
  await expect(page.locator('#lobby-dialog')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('#horse-portrait')).toHaveAttribute('src', returnPreview);
  console.log('PASS: new room uses the current preview after returning home');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
