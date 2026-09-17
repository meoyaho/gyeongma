import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { startRoomTestServer } from '../tests/helpers/room-test-server.mjs';
// First build with VITE_SERVER_ORIGIN unset so the isolated server serves both
// the page and /ws. Production mode avoids unrelated development HMR sockets.

const server = await startRoomTestServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  for (const [device, userAgent] of [
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'],
    ['Galaxy', 'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36']
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent });
    const page = await context.newPage();
    const errors = [], joined = [], sent = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => {
      if (!socket.url().endsWith('/ws')) return;
      socket.on('framesent', ({ payload }) => sent.push(JSON.parse(String(payload)).type));
      socket.on('framereceived', ({ payload }) => {
        const data = JSON.parse(String(payload));
        if (data.type === 'joined') joined.push({ id: data.id, code: data.code });
      });
    });
    await page.goto(server.origin);
    await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('새벽콩콩이');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByRole('button', { name: '친구와 달리기', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '친구와 달리기', exact: true }).click();
    await expect(page.locator('#lobby-dialog')).toBeVisible();
    const identity = joined[0];
    assert.ok(identity);
    const saved = await page.evaluate(origin => JSON.parse(sessionStorage.getItem(`horse-room:${origin}`)), server.origin);
    assert.equal(saved.playerId, identity.id);
    assert.equal(new URL(page.url()).searchParams.get('room'), identity.code);
    assert.ok(!page.url().includes(saved.resumeToken));

    // Foreground event while both ends still see OPEN: resume must take over.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => joined.length).toBe(2);
    assert.deepEqual(joined[1], identity);
    await expect(page.locator('#lobby-players')).toContainText('방장');

    // OS discards/reloads the document: credentials must be read before reserve.
    await page.reload();
    await expect(page.locator('#lobby-dialog')).toBeVisible();
    await expect.poll(() => joined.length).toBe(3);
    assert.deepEqual(joined[2], identity);
    assert.equal(sent.filter(type => type === 'create').length, 1);
    assert.equal(sent.includes('reserve'), false, 'reload must reclaim the host, not reserve a guest seat');
    await expect(page.locator('#lobby-description')).toHaveText('1/8명 참가');

    // Simulate BFCache lifecycle without reloading the document.
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect.poll(() => joined.length).toBe(4);
    assert.deepEqual(joined[3], identity);
    await expect(page.locator('#connect-mic')).toBeVisible();
    assert.equal((await fetch(`${server.origin}/api/invite/${identity.code}`).then(r => r.json())).ok, true);

    // Explicit leave still removes the room and saved identity immediately.
    await page.locator('#lobby-dialog').dispatchEvent('cancel');
    await expect(page.locator('#lobby-dialog')).not.toBeVisible();
    assert.equal(await page.evaluate(origin => sessionStorage.getItem(`horse-room:${origin}`), server.origin), null);
    await expect.poll(async () => (await fetch(`${server.origin}/api/invite/${identity.code}`)).status).toBe(404);
    assert.deepEqual(errors, []);
    console.log(`PASS ${device}: foreground takeover, reload, BFCache, host/seat identity, explicit leave`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
