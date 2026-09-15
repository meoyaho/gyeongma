import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

// Real MP3 decoding/output, with deterministic room and speech-service fixtures.
// This verifies our audio graph and UI; iOS capture still requires a real phone.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--autoplay-policy=user-gesture-required', '--enable-unsafe-swiftshader'],
});
try {
  for (const mode of ['desktop', 'ios-on', 'ios-off', 'instagram']) {
    const mobile = mode !== 'desktop';
    const page = await browser.newPage({
      viewport: { width: mobile ? 390 : 1280, height: 844 },
      ...(mobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' + (mode === 'instagram' ? ' Instagram 400.0' : '') } : {}),
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.text().includes('배경음 재생 실패')) errors.push(message.text()); });
    await page.route('**/api/validate-name', route => route.fulfill({ json: { ok: true } }));
    await page.routeWebSocket('**/ws', socket => {
      let state;
      const publish = () => socket.send(JSON.stringify({ ...state, type: 'state', serverNow: Date.now() }));
      socket.onMessage(raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'create') {
          state = { code: 'ABCDEF', mode: 'solo', phase: 'lobby', host: 'me', startAt: Date.now(), players: [{ id: 'me', name: msg.name, lane: 0, appearance: 0, ready: false, connected: true, distance: 0, speed: 5, finishTime: null, totalCalls: 0 }] };
          socket.send(JSON.stringify({ type: 'joined', id: 'me', code: state.code, name: msg.name })); publish();
        } else if (msg.type === 'ready') { state.players[0].ready = msg.ready; publish(); }
        else if (msg.type === 'start') { state.phase = 'countdown'; state.startAt = Date.now() + 1000; publish(); setTimeout(() => { state.phase = 'racing'; publish(); }, 1000); }
        else if (msg.type === 'call') { state.players[0].totalCalls += msg.count; publish(); }
      });
    });
    await page.addInitScript(() => {
      // Chrome cannot reproduce the iOS mute switch; verify category requests
      // with a fixture while keeping MP3 decoding and the output graph real.
      Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
      window.testAudio = { contexts: [], sources: [], silent: [], gains: [], players: [] };
      const NativeContext = window.AudioContext, NativeAudio = window.Audio;
      window.AudioContext = class extends NativeContext {
        constructor(...args) { super(...args); window.testAudio.contexts.push(this); }
        createGain() {
          const gain = super.createGain();
          window.testAudio.gains.push(gain);
          if (!window.testAudio.analyser) {
            window.testAudio.analyser = this.createAnalyser();
            gain.connect(window.testAudio.analyser);
          }
          return gain;
        }
        createBufferSource() {
          const source = super.createBufferSource(), stop = source.stop.bind(source);
          source.stop = (...args) => { source.wasStopped = true; return stop(...args); };
          window.testAudio.sources.push(source); return source;
        }
        createConstantSource() {
          const source = super.createConstantSource(), stop = source.stop.bind(source);
          source.stop = (...args) => { source.wasStopped = true; return stop(...args); };
          window.testAudio.silent.push(source); return source;
        }
      };
      window.Audio = class extends NativeAudio { constructor(...args) { super(...args); window.testAudio.players.push(this); } };
      window.SpeechRecognition = class {
        start() { window.testRecognition = this; queueMicrotask(() => navigator.userAgent.includes('Instagram') ? this.onerror?.({ error: 'service-not-allowed' }) : this.onstart?.()); }
        abort() { setTimeout(() => this.onend?.(), 0); }
        emit(text) { this.onresult?.({ results: [[{ transcript: text }]] }); }
      };
    });
    const expectOutput = async audible => {
      await page.waitForFunction(expected => {
        const { analyser, contexts, gains } = window.testAudio;
        if (!analyser || contexts[0].state !== 'running' || gains[0].gain.value !== (expected ? 1 : 0)) return false;
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        const peak = Math.max(...data.map(Math.abs));
        return expected ? peak > 0.001 : peak === 0;
      }, audible);
    };
    const expectTrack = async number => {
      await page.waitForFunction(count => window.testAudio.sources.length === count && window.testAudio.sources.at(-1).buffer?.duration > 0 && !window.testAudio.sources.at(-1).wasStopped, number);
    };
    await page.goto(process.env.TEST_ORIGIN || 'http://127.0.0.1:3000');
    assert.equal(await page.evaluate(() => window.testAudio.contexts.length), 0);
    if (mode !== 'ios-off') {
      await page.locator('#home-sound-button').click();
      await expectTrack(1); await expectOutput(true);
      assert.equal(await page.evaluate(() => navigator.audioSession.type), 'playback');
      assert.equal(await page.evaluate(() => window.testRecognition === undefined), true);
    }
    await page.getByRole('textbox', { name: '말 이름', exact: true }).fill('바람을따라');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await page.getByRole('button', { name: '혼자 달리기', exact: true }).click();
    if (mode === 'desktop') await page.locator('#practice-button').click();
    else {
      await page.locator('#connect-mic').click();
      if (mode === 'instagram') {
        await expect(page.locator('#lobby-error')).toContainText('인스타그램');
        await expect(page.locator('#copy-lobby-browser-url')).toBeVisible();
        await expectOutput(true);
        assert.equal(await page.evaluate(() => navigator.audioSession.type), 'playback');
        assert.equal(await page.evaluate(() => window.testAudio.silent[0].wasStopped), true);
      } else {
        await expect(page.locator('#mic-title')).toHaveText('음성 인식 확인 중');
        await page.waitForFunction(() => window.testAudio.contexts[0].state === 'running');
        await page.evaluate(() => window.testRecognition.emit('바람을따라'));
        await expect(page.locator('#mic-transcript')).toHaveText('이름 1회 인식 · 바람을따라');
        await expect(page.locator('#start-race')).toBeVisible();
        if (mode === 'ios-off') await page.locator('#home-sound-button').click();
        await expectTrack(1); await expectOutput(true);
        assert.equal(await page.evaluate(() => navigator.audioSession.type), 'play-and-record');
      }
    }
    if (mode !== 'instagram') {
      await page.locator('#home-sound-button').click();
      await expectOutput(false); await expectTrack(1);
      assert.equal(await page.evaluate(() => navigator.audioSession.type), mobile ? 'play-and-record' : 'playback');
      if (mobile) {
        await page.evaluate(() => window.testRecognition.emit('바람을따라 바람을따라'));
        await expect(page.locator('#mic-transcript')).toContainText('이름 2회 인식');
      }
      await page.locator('#start-race').click();
      await expectTrack(2); await expectOutput(false);
      await page.locator('#sound-button').click();
      await expectOutput(true); await expectTrack(2);
      assert.equal(await page.evaluate(() => navigator.audioSession.type), mobile ? 'play-and-record' : 'playback');
      if (mobile) {
        await page.waitForFunction(() => window.testRecognition.onresult != null);
        await page.evaluate(() => window.testRecognition.emit('바람을따라'));
        await expect(page.locator('#call-count')).toHaveText('1회 인식');
      }
      await page.locator('#leave-race').click();
      await expectTrack(3); await expectOutput(true);
      assert.equal(await page.evaluate(() => navigator.audioSession.type), 'playback');
      if (mobile) assert.equal(await page.evaluate(() => window.testAudio.silent[0].wasStopped), true);
    }
    assert.equal(await page.evaluate(() => window.testAudio.contexts.length), 1);
    assert.equal(await page.evaluate(() => window.testAudio.players.length), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mode}: real music output, shared context, mute/track transitions and microphone cleanup`);
    await page.close();
  }
} finally { await browser.close(); }
