import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('배경음 재생 실패')) errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.testTracks = [];
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(...args) { super(...args); window.testTracks.push(this); }
    };
  });
  async function expectMusic(file) {
    await page.waitForFunction(expected => {
      const [track] = window.testTracks;
      return track && decodeURI(track.src).endsWith(expected) && !track.paused && track.currentTime > 0 && !track.error;
    }, file);
    const start = await page.evaluate(() => window.testTracks[0].currentTime);
    await page.waitForFunction(previous => window.testTracks[0].currentTime > previous + 0.2, start);
    assert.equal(await page.evaluate(() => window.testTracks.length), 1);
  }
  async function expectPaused() {
    assert.equal(await page.evaluate(() => window.testTracks.every(track => track.paused)), true);
  }
  await page.goto(process.env.TEST_ORIGIN || 'http://localhost:3000');
  await expectPaused();
  await page.getByRole('button', { name: '배경음 켜기', exact: true }).click();
  await expectMusic('대기실.mp3');
  await page.getByRole('button', { name: '배경음 끄기', exact: true }).click();
  await expectPaused();
  await page.getByRole('button', { name: '배경음 켜기', exact: true }).click();
  await expectMusic('대기실.mp3');
  console.log('PASS: home music and ON/OFF');
  await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '혼자 달리기', exact: true })).toBeEnabled({ timeout: 35000 });
  await page.getByRole('button', { name: '혼자 달리기', exact: true }).click();
  await page.getByRole('button', { name: '키보드로 체험', exact: false }).waitFor({ timeout: 35000 });
  await expectMusic('대기실.mp3');
  console.log('PASS: lobby music');
  await page.getByRole('button', { name: '키보드로 체험', exact: false }).click();
  await page.getByRole('button', { name: '경주 시작하기', exact: false }).click();
  await expectMusic('경주.mp3');
  await page.getByRole('button', { name: '사운드 끄기', exact: true }).click();
  await expectPaused();
  await page.getByRole('button', { name: '사운드 켜기', exact: true }).click();
  await expectMusic('경주.mp3');
  console.log('PASS: race track transition and ON/OFF');
  await page.getByRole('button', { name: '← 나가기', exact: true }).click();
  await expectMusic('대기실.mp3');
  await page.getByRole('button', { name: '배경음 끄기', exact: true }).click();
  await expectPaused();
  console.log('PASS: return home restores lobby music');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
