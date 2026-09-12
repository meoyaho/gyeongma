import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
await page.goto('http://localhost:3000');
await page.waitForFunction(() => {
  const image = document.querySelector('#horse-portrait');
  return image?.complete && image.naturalWidth === 1024;
});
assert.equal(await page.locator('#preview-name').textContent(), '내 이름은 ???');
assert.equal(await page.locator('#horse-number').textContent(), '1');

const ids = ['chestnut', 'palomino', 'black', 'white', 'pinto', 'dapple', 'roan', 'dun'];
const loaded = await page.evaluate(async horseIds => Promise.all(horseIds.map(id => new Promise(resolve => {
  const image = new Image();
  image.onload = () => resolve([id, image.naturalWidth, image.naturalHeight]);
  image.onerror = () => resolve([id, 0, 0]);
  image.src = `/horses/${id}.png?verify=1`;
}))), ids);
assert.deepEqual(loaded, ids.map(id => [id, 1024, 1024]));
console.log('Horse images:', loaded.map(([id]) => id).join(', '));

await page.screenshot({ path: 'test-results/home-emoji-desktop.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: 'test-results/home-emoji-mobile.png', fullPage: true });
await browser.close();
