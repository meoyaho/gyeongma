import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../src/voice.js';

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
test('cancelling while microphone permission is pending releases a late stream', async () => {
  let resolvePermission, stopped = false;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolvePermission = resolve; });
  const controller = new VoiceController({ onCalls() {}, onStatus() {}, onTranscript() {}, onLevel() {} });
  const start = controller.start('바람을따라');
  controller.stop();
  resolvePermission({ getTracks: () => [{ stop() { stopped = true; } }] });
  assert.equal(await start, false); assert.equal(stopped, true); assert.equal(controller.active, false);
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
