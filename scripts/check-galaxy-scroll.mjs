import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox']
});
try {
  for (const [width, height] of [[360, 800], [390, 600], [320, 568], [1440, 600]]) {
    const mobile = width <= 760;
    const page = await browser.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    await page.goto(process.env.TEST_ORIGIN || 'http://localhost:3000');
    await page.locator('#home-sound-button').waitFor();
    // Exercise the actual markup/styles without calling external name services.
    await page.evaluate(() => {
      document.getElementById('invite-area').classList.remove('hidden');
      document.getElementById('lobby-description').textContent = '친구들과 함께 달릴 준비를 해주세요.';
      document.getElementById('lobby-players').innerHTML = '<div class="player-card"><span>새벽콩콩이</span><span>준비 중</span></div>';
      document.getElementById('lobby-dialog').show();
    });
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      const swipe = async () => {
        const point = await page.locator('#lobby-dialog .modal-scroll').evaluate(el => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + 45 };
        });
        assert.ok(point.y > 0 && point.y < height, 'swipe starts inside the visible sheet');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        for (let i = 1; i <= 12; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - i * 12 }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await page.evaluate(() => {
        window.scrollTo(0, 70);
        document.querySelector('#lobby-dialog .modal-scroll').style.overscrollBehaviorY = 'contain';
      });
      await swipe();
      assert.equal(await page.evaluate(() => scrollY), 70, 'old contain rule reproduces the stuck page');
      await page.locator('#lobby-dialog .modal-scroll').evaluate(el => el.style.removeProperty('overscroll-behavior-y'));
      await swipe();
      await page.waitForFunction(() => scrollY > 90);
      console.log(`PASS mobile ${width}x${height}: swipe inside lobby scrolls page`);
      await cdp.detach();
    } else {
      const scroll = page.locator('#lobby-dialog .modal-scroll');
      assert.equal(await scroll.evaluate(el => getComputedStyle(el).overscrollBehaviorY), 'contain');
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await scroll.evaluate(el => el.scrollTop > 0));
      console.log(`PASS desktop ${width}x${height}: lobby retains internal scrolling`);
    }
    await page.evaluate(() => {
      document.getElementById('lobby-dialog').close();
      document.getElementById('result-board').innerHTML = Array.from({ length: 20 }, () => '<div class="result-row">경주 결과</div>').join('');
      document.getElementById('result-dialog').showModal();
    });
    const resultScroll = page.locator('#result-dialog .modal-scroll');
    assert.equal(await resultScroll.evaluate(el => getComputedStyle(el).overscrollBehaviorY), 'contain');
    await resultScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await resultScroll.evaluate(el => el.scrollTop > 0));
    console.log(`PASS result modal ${width}x${height}: internal scrolling preserved`);
    await page.close();
  }
} finally { await browser.close(); }
