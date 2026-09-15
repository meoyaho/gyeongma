import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController, getVoiceEnvironment } from '../src/voice.js';

test('speech interim/final updates count each name once and release microphone on stop', async () => {
  let stopped = 0, closed = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  class Recognition {
    start() { queueMicrotask(() => this.onstart?.()); }
    abort() {}
    emit(transcripts) { this.onresult({ results: transcripts.map(text => [{ transcript: text }]) }); }
  }
  class AudioContext {
    async resume() {}
    async close() { closed++; }
    createAnalyser() { return { frequencyBinCount: 128, getByteTimeDomainData: data => data.fill(128) }; }
    createMediaStreamSource() { return { connect() {} }; }
  }
  globalThis.window = { isSecureContext: true, SpeechRecognition: Recognition, AudioContext };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => stream } }, configurable: true });
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  const counts = [], statuses = [];
  const controller = new VoiceController({ onCalls: count => counts.push(count), onStatus: (...args) => statuses.push(args), onTranscript() {}, onLevel() {} });
  await controller.start('바람을따라');
  const rec = controller.recognition;
  assert.equal(rec.lang, 'ko-KR');
  rec.emit(['바람을']); assert.deepEqual(counts, []);
  rec.emit(['바람을 따라']); assert.deepEqual(counts, [1]);
  rec.emit(['바람을 따라']); assert.deepEqual(counts, [1]);
  rec.emit(['바람을 따라', '바람을 따라 바람을따라']); assert.deepEqual(counts, [1, 2]);
  rec.emit(['바람을 따라', '바람을 따라 바람을따라']); assert.deepEqual(counts, [1, 2]);
  rec.emit(['바람을 따라', '바람을 따라 바람을따라', '다른 말 아무 소리']); assert.deepEqual(counts, [1, 2]);
  rec.onerror({ error: 'network' });
  assert.equal(controller.active, false); assert.equal(stopped, 1); assert.equal(closed, 1);
  assert.equal(statuses.at(-1)[0], 'error');
});
test('cancelling while optional meter permission is pending releases a late stream', async () => {
  let resolvePermission, stopped = false;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolvePermission = resolve; });
  const controller = new VoiceController({ onCalls() {}, onStatus() {}, onTranscript() {}, onLevel() {} });
  assert.equal(await controller.start('바람을따라'), true);
  controller.stop();
  resolvePermission({ getTracks: () => [{ stop() { stopped = true; } }] });
  await Promise.resolve();
  assert.equal(stopped, true); assert.equal(controller.active, false);
});
test('a new race discards lobby hypotheses and ignores late events from the old recognizer', async () => {
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  const calls = [], progress = [], transcripts = [];
  const controller = new VoiceController({ onCalls: n => calls.push(n), onStatus() {}, onLevel() {}, onTranscript: text => transcripts.push(text), onProgress: p => progress.push(p) });
  await controller.start('바람을따라');
  const lobby = controller.recognition, lateResult = lobby.onresult;
  lobby.emit(['바람을']);
  assert.equal(progress.at(-1).progress, 3);
  controller.resetRecognition(); await Promise.resolve();
  assert.notEqual(controller.recognition, lobby);
  assert.equal(progress.at(-1).progress, 0); assert.equal(transcripts.at(-1), '');
  lateResult({ results: [[{ transcript: '바람을따라' }]] });
  assert.deepEqual(calls, []);
  controller.recognition.emit(['을따라']); assert.deepEqual(calls, []);
  controller.recognition.emit(['바람을따라']); assert.deepEqual(calls, [1]);
  controller.recognition.emit(['바람을따라']); assert.deepEqual(calls, [1]);
  controller.stop();
});
test('partial attempts expire and cannot be completed by a later suffix', async () => {
  const calls = [];
  const controller = new VoiceController({ onCalls: n => calls.push(n), onStatus() {}, onLevel() {}, onTranscript() {}, onProgress() {} });
  await controller.start('바람을따라');
  const old = controller.recognition;
  old.emit(['바람을']);
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.notEqual(controller.recognition, old);
  controller.recognition.emit(['따라']); assert.deepEqual(calls, []);
  controller.stop();
});

function setupVoice(t, device = {}) {
  const previousWindow = globalThis.window, previousNavigator = globalThis.navigator;
  const recognizers = [], statuses = [], levels = [];
  let captures = 0;
  class Recognition {
    constructor() { recognizers.push(this); }
    start() { this.started = true; }
    emit(text) { this.onresult?.({ results: [[{ transcript: text }]] }); }
    abort() { this.aborted = true; }
  }
  globalThis.window = { isSecureContext: true, webkitSpeechRecognition: Recognition };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    userAgent: 'iPhone', ...device,
    mediaDevices: { getUserMedia: async () => { captures++; throw new Error('meter unavailable'); } }
  } });
  const controller = new VoiceController({ onCalls() {}, onTranscript() {}, onStatus: (...args) => statuses.push(args), onLevel: level => levels.push(level) });
  t.after(() => {
    controller.stop();
    globalThis.window = previousWindow;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: previousNavigator });
  });
  return { controller, recognizers, statuses, levels, captures: () => captures };
}

for (const device of [
  { userAgent: 'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1' },
  { userAgent: 'Mozilla/5.0 (iPhone) CriOS/140.0 Mobile Safari/604.1' },
  { userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36' },
  { userAgent: 'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }
]) {
  test(`mobile starts within the tap without a second microphone capture: ${device.userAgent}`, async t => {
    const { controller, recognizers, levels, captures } = setupVoice(t, device);
    const start = controller.start('바람을따라');
    assert.equal(recognizers.length, 1, 'recognition is constructed before yielding the button gesture');
    const rec = recognizers[0];
    assert.equal(rec.started, true);
    rec.onstart();
    rec.emit('바람을따라');
    assert.equal(await start, true);
    assert.equal(captures(), 0, 'mobile never opens a volume-meter capture');
    rec.onspeechstart(); assert.equal(levels.at(-1), 0.65);
    rec.onspeechend(); assert.equal(levels.at(-1), 0);
  });
}

for (const [code, expected] of [
  ['not-allowed', /사이트 설정/], ['service-not-allowed', /Siri/],
  ['audio-capture', /마이크 입력/], ['network', /인터넷 연결/]
]) {
  test(`startup preserves the actual ${code} error and allows retry`, async t => {
    const { controller, recognizers, statuses } = setupVoice(t);
    const start = controller.start('바람을따라');
    const rejection = assert.rejects(start, expected);
    recognizers[0].onerror({ error: code });
    await rejection;
    assert.equal(controller.active, false);
    assert.match(statuses.at(-1)[1], expected);
    const retry = controller.start('바람을따라');
    recognizers[1].onstart(); recognizers[1].emit('바람을따라');
    assert.equal(await retry, true);
  });
}

test('recognition can connect even when optional desktop metering fails', async t => {
  const { controller, recognizers, captures, statuses } = setupVoice(t, { userAgent: 'Desktop Chrome' });
  const start = controller.start('바람을따라');
  recognizers[0].onstart();
  assert.equal(await start, true);
  await Promise.resolve();
  assert.equal(captures(), 1);
  assert.equal(controller.active, true);
  assert.equal(statuses.at(-1)[0], 'listening');
});

test('an early no-speech/end can restart and settle the original connection', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, recognizers } = setupVoice(t);
  const start = controller.start('바람을따라');
  recognizers[0].onerror({ error: 'no-speech' });
  recognizers[0].onend();
  t.mock.timers.tick(180);
  assert.equal(recognizers.length, 2);
  recognizers[1].onstart(); recognizers[1].emit('바람을따라');
  assert.equal(await start, true);
  t.mock.timers.tick(12000);
  assert.equal(controller.active, true, 'ready clears the original timeout');
});

test('startup timeout preserves its message even after an early no-speech', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, recognizers } = setupVoice(t);
  const start = controller.start('바람을따라');
  const rejection = assert.rejects(start, /연결이 지연/);
  recognizers[0].onerror({ error: 'no-speech' });
  t.mock.timers.tick(12000);
  await rejection;
  assert.equal(controller.active, false);
  assert.equal(recognizers[0].aborted, true);
});

test('cancelled startup and late events cannot stop a new connection', async t => {
  const { controller, recognizers } = setupVoice(t);
  const start = controller.start('바람을따라');
  const rejection = assert.rejects(start, /연결이 종료/);
  const oldStart = recognizers[0].onstart;
  controller.stop();
  const retry = controller.start('바람을따라');
  oldStart();
  recognizers[1].onstart(); recognizers[1].emit('바람을따라');
  await rejection;
  assert.equal(await retry, true);
  assert.equal(controller.active, true);
});


test('Instagram service refusal gives external-browser guidance without blaming Siri', async t => {
  const { controller, recognizers } = setupVoice(t, { userAgent: 'Mozilla/5.0 (iPhone) Instagram 400.0' });
  const start = controller.start('바람을따라');
  const rejection = assert.rejects(start, error => /인스타그램.*주소를 복사해 Safari/.test(error.message) && !error.message.includes('Siri'));
  recognizers[0].onerror({ error: 'service-not-allowed' });
  await rejection;
});

test('mobile readiness requires an actual nonempty transcription, not mic or speech events', async t => {
  const { controller, recognizers, statuses } = setupVoice(t);
  let connected = false;
  const start = controller.start('바람을따라').then(value => { connected = value; });
  const rec = recognizers[0];
  rec.onstart(); rec.onspeechstart(); rec.emit('  ');
  await Promise.resolve();
  assert.equal(connected, false);
  assert.equal(statuses.at(-1)[0], 'checking');
  rec.emit('바람을따라');
  await start;
  assert.equal(connected, true);
  assert.equal(statuses.at(-1)[0], 'listening');
});

test('mobile mic without results times out and releases capture rather than reporting ready', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, recognizers, statuses } = setupVoice(t);
  const start = controller.start('바람을따라');
  const rejection = assert.rejects(start, /아직 인식된 말이 없어요/);
  recognizers[0].onstart();
  t.mock.timers.tick(15000);
  await rejection;
  assert.equal(controller.active, false);
  assert.equal(recognizers[0].aborted, true);
  assert.equal(statuses.at(-1)[0], 'error');
});

function mockAudioSession() {
  const events = [];
  navigator.audioSession = { type: 'auto' };
  window.AudioContext = class {
    constructor() { this.destination = {}; events.push('context'); }
    createConstantSource() {
      const source = { offset: { value: 1 }, connect() {}, start() { assert.equal(source.offset.value, 0); events.push('silent-start'); }, stop() { events.push('silent-stop'); }, disconnect() {} };
      return source;
    }
    resume() { events.push('resume'); return Promise.resolve(); }
    close() { events.push('close'); return Promise.resolve(); }
  };
  return events;
}

test('iOS activates a silent audio session from the mic tap independently of music', async t => {
  const { controller, recognizers, captures } = setupVoice(t);
  const events = mockAudioSession();
  const Recognition = window.webkitSpeechRecognition;
  window.webkitSpeechRecognition = class extends Recognition {
    start() { events.push('recognition-start'); super.start(); }
  };
  const start = controller.start('바람을따라');
  assert.deepEqual(events, ['context', 'silent-start', 'resume', 'recognition-start']);
  assert.equal(navigator.audioSession.type, 'play-and-record');
  recognizers[0].onstart(); recognizers[0].emit('바람을따라');
  assert.equal(await start, true);
  assert.equal(captures(), 0);
  controller.stop();
  assert.deepEqual(events.slice(-2), ['silent-stop', 'close']);
  assert.equal(navigator.audioSession.type, 'auto');
});

test('iOS audio-session failure rejects startup and cleans up the microphone', async t => {
  const { controller, recognizers } = setupVoice(t);
  const events = mockAudioSession();
  window.AudioContext.prototype.resume = () => Promise.reject(new Error('interrupted'));
  const start = controller.start('바람을따라');
  await assert.rejects(start, /오디오 입력을 시작하지 못했어요/);
  assert.equal(recognizers[0].aborted, true);
  assert.equal(navigator.audioSession.type, 'auto');
  assert.ok(events.includes('close'));
});

test('iOS recognizer replacement waits for mic release and preserves its audio session', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, recognizers } = setupVoice(t);
  const events = mockAudioSession();
  const start = controller.start('바람을따라');
  const old = recognizers[0], lateResult = old.onresult;
  old.onstart(); old.emit('바람을따라'); await start;
  controller.resetRecognition();
  assert.equal(recognizers.length, 1);
  assert.equal(old.aborted, true);
  assert.equal(events.includes('close'), false);
  controller.resetRecognition(); // Another reset must not cancel pending release.
  old.onend();
  t.mock.timers.tick(179); assert.equal(recognizers.length, 1);
  t.mock.timers.tick(1); assert.equal(recognizers.length, 2);
  recognizers[1].onstart();
  lateResult({ results: [[{ transcript: '바람을따라' }]] });
  assert.equal(controller.recognition, recognizers[1]);
});

test('iOS release fallback is bounded and cancelled when the user stops', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { controller, recognizers } = setupVoice(t);
  const start = controller.start('바람을따라');
  recognizers[0].onstart(); recognizers[0].emit('바람을따라'); await start;
  controller.resetRecognition();
  t.mock.timers.tick(1000); t.mock.timers.tick(180);
  assert.equal(recognizers.length, 2);
  controller.resetRecognition();
  const lateEnd = recognizers[1].onend;
  controller.stop();
  lateEnd(); t.mock.timers.tick(2000);
  assert.equal(recognizers.length, 2);
});

test('voice environment detects Instagram and desktop-mode iPad independently', () => {
  assert.deepEqual(getVoiceEnvironment({ userAgent: 'Android Instagram' }), { ios: false, mobile: true, instagram: true });
  assert.deepEqual(getVoiceEnvironment({ userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5 }), { ios: true, mobile: true, instagram: false });
});
