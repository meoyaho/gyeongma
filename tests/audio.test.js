import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.js';

function setup(t, fetcher = async url => ({ ok: true, arrayBuffer: async () => url })) {
  const contexts = [], sources = [], requests = [];
  class Context {
    constructor() { this.state = 'suspended'; this.destination = {}; contexts.push(this); }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() {
      const source = { connect() {}, start() { this.started = true; }, stop() { this.stopped = true; }, disconnect() {} };
      sources.push(source); return source;
    }
    async decodeAudioData(data) { return data; }
    async resume() { this.resumes = (this.resumes || 0) + 1; this.state = 'running'; this.onstatechange?.(); }
    async close() { this.state = 'closed'; }
  }
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = { AudioContext: Context };
  globalThis.document = { hidden: false };
  t.after(() => { globalThis.window = previousWindow; globalThis.document = previousDocument; });
  t.mock.method(globalThis, 'fetch', url => { requests.push(url); return fetcher(url); });
  const errors = [];
  const audio = new GameAudio({ sources: { lobby: 'lobby', racing: 'racing' }, onError: e => errors.push(e) });
  t.after(() => audio.dispose());
  return { audio, contexts, sources, requests, errors };
}

test('sound OFF preserves the music loop and shared context; ON restores gain without restarting', async t => {
  const { audio, sources, contexts, requests } = setup(t);
  audio.setEnabled(true);
  await audio.setTrack('lobby');
  const source = audio.source;
  audio.setEnabled(false);
  await audio.setTrack('lobby');
  assert.equal(audio.output.gain.value, 0);
  assert.equal(source.stopped, undefined);
  assert.equal(audio.context.state, 'running');
  audio.setEnabled(true);
  await audio.setTrack('lobby', true);
  assert.equal(audio.output.gain.value, 1);
  assert.equal(audio.source, source);
  assert.equal(contexts.length, 1);
  assert.equal(sources.length, 1);
  assert.deepEqual(requests, ['lobby']);
});

test('a late lobby download cannot replace race music, and returning home uses its cached buffer', async t => {
  let finishLobby;
  const { audio, sources, requests } = setup(t, url => url === 'lobby' ? new Promise(resolve => { finishLobby = resolve; }) : Promise.resolve({ ok: true, arrayBuffer: async () => url }));
  audio.setEnabled(true);
  const pending = audio.setTrack('lobby');
  await audio.setTrack('racing');
  const race = audio.source;
  finishLobby({ ok: true, arrayBuffer: async () => 'lobby' });
  await pending;
  assert.equal(audio.source, race);
  assert.equal(sources.length, 1);
  audio.setEnabled(false);
  await audio.setTrack('lobby');
  assert.equal(race.stopped, true);
  assert.equal(audio.source.buffer, 'lobby');
  assert.equal(audio.output.gain.value, 0);
  assert.deepEqual(requests, ['lobby', 'racing']);
  await audio.setTrack(null);
  assert.equal(audio.source, null);
});

test('failed downloads do not retry on every game state, but a sound toggle can retry', async t => {
  const { audio, errors, requests } = setup(t, async () => ({ ok: false, status: 503 }));
  audio.setEnabled(true);
  await audio.setTrack('lobby');
  await audio.setTrack('lobby');
  assert.equal(requests.length, 1);
  assert.equal(errors.length, 1);
  await audio.setTrack('lobby', true);
  assert.equal(requests.length, 2);
});

test('disposing during download prevents late playback', async t => {
  let finish;
  const { audio, sources } = setup(t, () => new Promise(resolve => { finish = resolve; }));
  const pending = audio.setTrack('lobby');
  audio.dispose();
  finish({ ok: true, arrayBuffer: async () => 'lobby' });
  await pending;
  assert.equal(sources.length, 0);
  assert.equal(audio.context.state, 'closed');
});

test('interrupted output gets one recovery attempt, with no retry loop or hidden-page resume', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { audio } = setup(t);
  audio.setEnabled(true);
  const context = audio.context;
  let attempts = 0;
  context.resume = async () => { attempts++; context.onstatechange(); };
  context.state = 'interrupted';
  context.onstatechange();
  t.mock.timers.tick(250);
  await Promise.resolve();
  context.onstatechange();
  t.mock.timers.tick(1000);
  assert.equal(attempts, 1);
  context.state = 'running'; context.onstatechange();
  document.hidden = true;
  context.state = 'suspended'; context.onstatechange();
  t.mock.timers.tick(1000);
  assert.equal(attempts, 1);
});

function mockSession(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const changes = [];
  let type = 'auto';
  const session = { get type() { return type; }, set type(value) { type = value; changes.push(value); } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { audioSession: session } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  });
  return { session, changes };
}

test('sound ON selects playback before resume; capture and mute toggles preserve recording mode', async t => {
  const { session, changes } = mockSession(t);
  const { audio } = setup(t);
  const context = audio.getContext();
  context.resume = async () => { assert.equal(session.type, 'playback'); context.state = 'running'; };
  audio.setEnabled(true);
  assert.equal(session.type, 'playback');
  const release = audio.acquireCaptureSession();
  assert.equal(session.type, 'play-and-record');
  audio.setEnabled(false); audio.setEnabled(true);
  assert.equal(session.type, 'play-and-record');
  release(); release();
  assert.equal(session.type, 'playback');
  audio.setEnabled(false);
  assert.equal(session.type, 'playback', 'OFF only mutes; it does not switch the output category');
  audio.dispose();
  assert.deepEqual(changes, ['playback', 'play-and-record', 'playback', 'auto']);
});

test('music enabled after mic connection returns to playback, not the original muted category', async t => {
  const { session } = mockSession(t);
  const { audio } = setup(t);
  const release = audio.acquireCaptureSession();
  assert.equal(session.type, 'play-and-record');
  audio.setEnabled(true);
  assert.equal(session.type, 'play-and-record');
  release();
  assert.equal(session.type, 'playback');
  const retry = audio.acquireCaptureSession();
  assert.equal(session.type, 'play-and-record');
  retry();
  assert.equal(session.type, 'playback');
});

test('capture without music restores the original session and unsupported setters do not block playback', async t => {
  const { session } = mockSession(t);
  const { audio, errors } = setup(t);
  audio.acquireCaptureSession()();
  assert.equal(session.type, 'auto');
  Object.defineProperty(session, 'type', { set() { throw new Error('unsupported'); } });
  audio.setEnabled(true);
  await audio.setTrack('lobby');
  assert.ok(audio.source.started);
  assert.deepEqual(errors, []);
});
