import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  await page.addInitScript(() => {
    class Recognition {
      start() { window.testRecognition = this; queueMicrotask(() => this.onstart?.()); }
      abort() {}
      emit(text) { this.onresult?.({ results: [[{ transcript: text }]] }); }
    }
    class TestAudioContext {
      async resume() {} async close() {}
      createAnalyser() { return { frequencyBinCount: 128, getByteTimeDomainData: data => data.fill(128) }; }
      createMediaStreamSource() { return { connect() {} }; }
    }
    window.SpeechRecognition = Recognition; window.AudioContext = TestAudioContext;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  });
  await page.goto('http://localhost:3000');
  await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '혼자 달리기', exact: true }).click();
  await page.getByRole('button', { name: '마이크 연결하기', exact: false }).click();
  await page.getByRole('button', { name: '경주 시작하기', exact: false }).waitFor();
  await page.evaluate(() => { window.lobbyRecognition = window.testRecognition; window.testRecognition.emit('대기실에서 한 말 바람을'); });
  await expect(page.locator('#mic-transcript')).toContainText('대기실에서 한 말');
  await page.getByRole('button', { name: '경주 시작하기', exact: false }).click();
  await page.getByText('달려!', { exact: true }).waitFor({ timeout: 8000 });
  assert.equal(await page.evaluate(() => window.testRecognition === window.lobbyRecognition), false);
  await expect(page.locator('#mic-transcript')).toHaveText('');
  await expect(page.locator('#transcript')).toHaveText('');
  await page.evaluate(() => window.testRecognition.emit('바람을'));
  await expect(page.locator('#shout-name .recognized')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/name-karaoke-partial.png' });
  await page.evaluate(() => window.testRecognition.emit('바람을 바'));
  await expect(page.locator('#shout-name .recognized')).toHaveCount(1);
  await expect(page.locator('#call-count')).toHaveText('0회 인식');
  await page.evaluate(() => window.testRecognition.emit('바람을 바람을따라'));
  await expect(page.locator('#call-count')).toHaveText('1회 인식');
  await page.evaluate(() => window.testRecognition.emit('바람을 바람을따라'));
  await expect(page.locator('#call-count')).toHaveText('1회 인식');
  await page.evaluate(() => window.testRecognition.emit('바람을 바람을따라 다른 말은 보이면 안 됩니다'));
  await expect(page.locator('#transcript')).toHaveText('');
  await expect(page.locator('#shout-name')).toHaveText('바람을따라');
  await expect(page.locator('#shout-name .recognized')).toHaveCount(0);
  console.log('Voice UI: lobby transcript discarded, partial/restart colors correct, one full call counted, unrelated speech hidden.');
} finally { await browser.close(); }
