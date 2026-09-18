import { chromium, expect } from '@playwright/test';

// Verifies that a friends-room guest whose mic was never connected when the
// host starts the race falls back to a working keyboard experience instead
// of a broken/blank race view: their own name if they had one, otherwise a
// freshly assigned random name so keyboard input has something to match.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox'],
});

async function run({ typeName }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => { throw error; });
  await page.route('**/api/validate-name', route => route.fulfill({ json: { ok: true } }));
  let state;
  await page.routeWebSocket('**/ws', socket => {
    const publish = () => socket.send(JSON.stringify({ ...state, type: 'state', serverNow: Date.now() }));
    const start = () => {
      state.phase = 'countdown'; state.startAt = Date.now(); publish();
      setTimeout(() => { state.phase = 'racing'; publish(); }, 50);
    };
    socket.onMessage(raw => {
      const msg = JSON.parse(raw);
      if (msg.type === 'reserve') {
        state = { code: 'ABCDEF', mode: 'friends', phase: 'lobby', host: 'host', startAt: null,
          players: [
            { id: 'host', name: '방장이름', lane: 0, appearance: 0, ready: true, connected: true, distance: 0, speed: 5, finishTime: null, totalCalls: 0 },
            { id: 'me', name: '', reserved: true, lane: 1, appearance: 1, ready: false, connected: true, distance: 0, speed: 5, finishTime: null, totalCalls: 0 },
          ] };
        socket.send(JSON.stringify({ type: 'reserved', id: 'me', code: state.code, lane: 1, appearance: 1, reservationToken: 'tok' })); publish();
        if (!typeName) setTimeout(start, 200); // host starts before this guest ever names itself
      } else if (msg.type === 'claim') {
        const me = state.players.find(p => p.id === 'me'); me.name = msg.name; me.reserved = false;
        socket.send(JSON.stringify({ type: 'joined', id: 'me', code: state.code, name: msg.name, mode: state.mode, resumeToken: 'tok' })); publish();
        setTimeout(start, 200); // host starts before this guest connects its mic
      } else if (msg.type === 'call') {
        const me = state.players.find(p => p.id === 'me'); me.totalCalls += msg.count; publish();
      }
    });
  });
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      start() { window.testRecognition = this; queueMicrotask(() => this.onstart?.()); }
      abort() { setTimeout(() => this.onend?.(), 0); }
    };
  });
  await page.goto((process.env.TEST_ORIGIN || 'http://127.0.0.1:3000') + '/?room=ABCDEF');
  await page.waitForLoadState('networkidle');
  if (typeName) {
    await page.getByRole('textbox', { name: '말 이름', exact: true }).fill(typeName);
    await page.getByRole('button', { name: '완료', exact: true }).click();
  }
  // The guest never clicks "마이크 연결하기" in the lobby before the host starts.
  await page.waitForFunction(() => document.getElementById('countdown-number')?.textContent === '달려!', null, { timeout: 10000 });
  await expect(page.locator('#input-status')).toContainText('이름을 따라 써주세요');
  await expect(page.locator('#keyboard-name-input')).toBeVisible();
  const shoutName = await page.locator('#shout-name').textContent();
  if (typeName) assert(shoutName === typeName, `expected own name "${typeName}", got "${shoutName}"`);
  else assert(shoutName.length >= 4, `expected a random assigned name, got "${shoutName}"`);
  await page.locator('#keyboard-name-input').fill(shoutName);
  await expect(page.locator('#call-count')).toContainText('1회');
  console.log(`OK (typeName=${JSON.stringify(typeName)}): late-mic guest falls back to keyboard with "${shoutName}"`);
  await page.close();
}

function assert(condition, message) { if (!condition) throw new Error(message); }

await run({ typeName: '바람을따라' });
await run({ typeName: null });
await browser.close();
