import { chromium, expect } from '@playwright/test';

// Verifies that a friends-room guest who never connected their mic before the
// host started the race can still see a way to connect mid-race and have
// their calls count, instead of a permanently broken/blank race view.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', error => { throw error; });
await page.route('**/api/validate-name', route => route.fulfill({ json: { ok: true } }));
let state;
await page.routeWebSocket('**/ws', socket => {
  const publish = () => socket.send(JSON.stringify({ ...state, type: 'state', serverNow: Date.now() }));
  socket.onMessage(raw => {
    const msg = JSON.parse(raw);
    if (msg.type === 'join' || msg.type === 'create') {
      state = { code: 'ABCDEF', mode: 'friends', phase: 'lobby', host: 'host', startAt: null,
        players: [
          { id: 'host', name: '방장이름', lane: 0, appearance: 0, ready: true, connected: true, distance: 0, speed: 5, finishTime: null, totalCalls: 0 },
          { id: 'me', name: msg.name, lane: 1, appearance: 1, ready: false, connected: true, distance: 0, speed: 5, finishTime: null, totalCalls: 0 },
        ] };
      socket.send(JSON.stringify({ type: 'joined', id: 'me', code: state.code, name: msg.name })); publish();
    } else if (msg.type === 'call') {
      const me = state.players.find(p => p.id === 'me'); me.totalCalls += msg.count; publish();
    }
  });
  // Simulate the host starting the race without waiting on the guest ("me"), once joined.
  const waitForJoin = setInterval(() => {
    if (!state) return;
    clearInterval(waitForJoin);
    state.phase = 'countdown'; state.startAt = Date.now(); publish();
    setTimeout(() => { state.phase = 'racing'; publish(); }, 50);
  }, 100);
});
await page.addInitScript(() => {
  window.SpeechRecognition = class {
    start() { window.testRecognition = this; queueMicrotask(() => this.onstart?.()); }
    abort() { setTimeout(() => this.onend?.(), 0); }
    emit(text) { this.onresult?.({ results: [[{ transcript: text }]] }); }
  };
});
await page.goto((process.env.TEST_ORIGIN || 'http://127.0.0.1:3000') + '/?room=ABCDEF');
await page.waitForLoadState('networkidle');
await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
await page.getByRole('button', { name: '완료', exact: true }).click();
// The guest never clicks "마이크 연결하기" in the lobby before the host starts.
await page.waitForFunction(() => document.getElementById('countdown-number')?.textContent === '달려!', null, { timeout: 10000 });
await expect(page.locator('#input-status')).toContainText('마이크를 연결해주세요');
await expect(page.locator('#reconnect-mic')).toBeVisible();
await page.locator('#reconnect-mic').click();
await page.waitForFunction(() => window.testRecognition?.onresult != null);
await expect(page.locator('#input-status')).toContainText('이름을 불러주세요');
await page.evaluate(() => window.testRecognition.emit('바람을따라'));
await expect(page.locator('#call-count')).toContainText('1회');
console.log('OK: late mic connect during race counts calls correctly');
await browser.close();
