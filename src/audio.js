// Music, effects and the microphone keep-alive share one Web Audio session.
// Muting changes gain only: pausing an HTML media element can disrupt iOS speech.
export class GameAudio {
  constructor({ sources, onError = console.warn, shouldResume = () => this.enabled }) {
    Object.assign(this, { sources, onError, shouldResume });
    this.enabled = false;
    this.buffers = new Map();
    this.request = 0;
  }
  getContext() {
    if (this.disposed) throw new Error('Audio is disposed');
    if (this.context) return this.context;
    const Context = window.AudioContext || window.webkitAudioContext;
    const context = this.context = new Context();
    this.output = context.createGain();
    this.output.gain.value = this.enabled ? 1 : 0;
    this.output.connect(context.destination);
    this.musicGain = context.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.output);
    context.onstatechange = () => {
      if (context.state === 'running') { this.recoveryAttempted = false; return; }
      if (context.state === 'closed' || this.disposed || this.recoveryAttempted || !this.shouldResume() || document.hidden) return;
      // One attempt per interruption; a denied resume must not create a loop.
      this.recoveryAttempted = true;
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = setTimeout(() => {
        if (!this.disposed && !document.hidden && this.shouldResume()) void this.resume();
      }, 250);
    };
    return context;
  }
  async resume() {
    try {
      const context = this.getContext();
      if (context.state !== 'running') await context.resume();
    } catch (error) { if (!this.disposed) this.onError(error); }
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this.playbackRequested = true;
      this.updateSession();
      // Resume synchronously inside the sound-button gesture, before fetching.
      void this.resume();
    }
    if (this.output) this.output.gain.value = enabled ? 1 : 0;
  }
  updateSession() {
    if (this.disposed) return;
    // WebKit's automatic Web Audio category can follow the iPhone mute switch.
    // Select music playback explicitly, but never override active mic capture.
    // https://bugs.webkit.org/show_bug.cgi?id=237322#c6
    try {
      const session = globalThis.navigator?.audioSession;
      if (!session) return;
      if (!this.session) {
        this.session = session;
        this.previousSessionType = session.type;
      }
      const type = this.captures ? 'play-and-record' : this.playbackRequested ? 'playback' : this.previousSessionType;
      if (session.type !== type) session.type = type;
    } catch { /* Older browsers may expose an unsupported session setter. */ }
  }
  acquireCaptureSession() {
    this.captures = (this.captures || 0) + 1;
    this.updateSession();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.captures--;
      this.updateSession();
    };
  }
  load(track) {
    if (!this.buffers.has(track)) {
      const context = this.getContext();
      const pending = fetch(this.sources[track]).then(response => {
        if (!response.ok) throw new Error(`Music request failed: ${response.status}`);
        return response.arrayBuffer();
      }).then(data => context.decodeAudioData(data)).catch(error => {
        this.buffers.delete(track);
        throw error;
      });
      this.buffers.set(track, pending);
    }
    return this.buffers.get(track);
  }
  async setTrack(track, retry = false) {
    if (this.disposed || (this.track === track && !(retry && this.failed))) return;
    this.track = track;
    this.failed = false;
    const request = ++this.request;
    this.stopSource();
    if (!track) return;
    try {
      const buffer = await this.load(track);
      if (this.disposed || request !== this.request) return;
      const source = this.source = this.getContext().createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.musicGain);
      source.start();
    } catch (error) {
      if (this.disposed || request !== this.request) return;
      this.failed = true;
      if (this.enabled) this.onError(error);
    }
  }
  stopSource() {
    if (!this.source) return;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }
  hoof() {
    const context = this.context;
    if (!this.enabled || context?.state !== 'running') return;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(135, context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, context.currentTime + .06);
    gain.gain.setValueAtTime(.1, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .08);
    osc.connect(gain); gain.connect(this.output);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(); osc.stop(context.currentTime + .09);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.request++;
    clearTimeout(this.recoveryTimer);
    this.stopSource();
    this.buffers.clear();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    if (this.session) {
      try { this.session.type = this.previousSessionType; } catch {}
      this.session = null;
    }
  }
}
