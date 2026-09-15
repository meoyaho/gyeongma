import { analyzeNameProgress } from './name-progress.js';

export function getVoiceEnvironment(info = navigator) {
  const ua = info.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (info.platform === 'MacIntel' && info.maxTouchPoints > 1);
  return { ios, mobile: ios || /Android|Mobi/i.test(ua), instagram: /Instagram/i.test(ua) };
}

export class VoiceController {
  constructor({ onCalls, onStatus, onTranscript, onLevel, onProgress }) {
    Object.assign(this, { onCalls, onStatus, onTranscript, onLevel, onProgress });
    this.active = false;
    this.name = '';
  }
  async start(name) {
    this.stop();
    this.name = name;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.isSecureContext) throw new Error('마이크를 사용하려면 HTTPS 주소 또는 localhost에서 열어주세요.');
    if (!Recognition) throw new Error('이 브라우저는 한국어 음성 인식을 지원하지 않아요. 아이폰은 Safari, 안드로이드는 Chrome에서 열어주세요.');
    const generation = this.generation;
    // iPadOS can identify itself as a Mac. Mobile recognition owns the mic:
    // a second capture for the volume meter can interrupt that audio session.
    Object.assign(this, getVoiceEnvironment());
    this.active = true;
    this.Recognition = Recognition;
    try {
      // iOS needs an active audio session even with game sound OFF. Resume in
      // the tap itself; do not wait for music playback or a second mic capture.
      if (this.ios) this.startAudioSession(generation);
      // Start directly in the button gesture, before any permission/resume await.
      await new Promise((resolve, reject) => {
        this.pendingStart = { resolve, reject };
        this.readyTimer = setTimeout(() => {
          this.stop(new Error('음성 인식 연결이 지연돼요. 마이크 권한과 인터넷 연결을 확인한 뒤 다시 눌러주세요.'));
        }, 12000);
        this.createRecognition().start();
      });
      if (this.generation !== generation || !this.active) return false;
      // Metering is optional and must never block successful recognition.
      if (!this.mobile) void this.startMeter(generation);
      return true;
    } catch (error) {
      if (this.generation === generation) this.stop(error);
      throw error;
    }
  }
  startAudioSession(generation) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (navigator.audioSession) {
        this.previousAudioSessionType = navigator.audioSession.type;
        navigator.audioSession.type = 'play-and-record';
      }
    } catch { this.previousAudioSessionType = undefined; }
    const context = this.sessionContext = new AudioContext();
    // A silent, running source keeps WebKit's audio unit active between speech
    // sessions. It is separate from the user's music and never records audio.
    const source = this.sessionSource = context.createConstantSource();
    source.offset.value = 0;
    source.connect(context.destination);
    source.start();
    context.resume().catch(() => {
      if (this.generation !== generation || !this.active) return;
      const message = '오디오 입력을 시작하지 못했어요. Safari에서 페이지를 새로고침한 뒤 마이크를 다시 연결해주세요.';
      this.stop(new Error(message)); this.onStatus('error', message);
    });
  }
  confirmRecognition() {
    clearTimeout(this.readyTimer);
    const pending = this.pendingStart; this.pendingStart = null;
    pending?.resolve();
    this.onStatus('listening', '음성 인식 확인됨 · 이름을 불러보세요');
  }
  showRecognitionActivity() {
    if (!this.mobile || !this.active) return;
    clearTimeout(this.activityTimer);
    const generation = this.generation;
    let step = 0;
    const levels = [0.85, 0.7, 0.5, 0.32, 0.18, 0.08, 0];
    const tick = () => {
      if (!this.active || this.generation !== generation) return;
      this.onLevel?.(levels[step++]);
      this.activityTimer = step < levels.length ? setTimeout(tick, 90) : null;
    };
    tick();
  }
  async startMeter(generation) {
    let stream, context;
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.generation !== generation || !this.active) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      context = this.context = new (window.AudioContext || window.webkitAudioContext)();
      await context.resume();
      if (this.generation !== generation || !this.active) return;
      const analyser = this.analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const meter = () => {
        if (!this.active || this.generation !== generation) return;
        analyser.getByteTimeDomainData(data);
        this.onLevel?.(Math.min(1, Math.sqrt(data.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / data.length) * 5));
        this.frame = requestAnimationFrame(meter);
      };
      meter();
    } catch {
      if (this.generation !== generation) return;
      stream?.getTracks().forEach(t => t.stop());
      context?.close().catch(() => {});
      this.stream = this.context = this.analyser = null;
      this.onLevel?.(0);
    }
  }
  createRecognition() {
    const rec = this.recognition = new this.Recognition();
    rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    let highWater = 0, lastText = '';
    rec.onstart = () => {
      if (this.recognition !== rec || !this.active) return;
      highWater = 0; lastText = '';
      this.onProgress?.({ progress: 0, calls: 0 });
      if (this.mobile && this.pendingStart) {
        // The orange mic indicator/onstart alone does not prove transcription.
        // Do not extend this deadline on recognizer restarts.
        if (!this.awaitingFirstResult) {
          this.awaitingFirstResult = true;
          clearTimeout(this.readyTimer);
          this.readyTimer = setTimeout(() => {
            const message = `아직 인식된 말이 없어요. 마이크를 다시 연결하고 이름을 불러주세요. ${this.ios ? '계속 반응이 없으면 Safari에서 새로고침하고 설정의 받아쓰기를 확인해주세요.' : '계속 반응이 없으면 Chrome에서 새로고침하고 마이크 권한과 인터넷 연결을 확인해주세요.'}`;
            this.stop(new Error(message)); this.onStatus('error', message);
          }, 15000);
        }
        this.onStatus('checking', `“${this.name}”을 불러주세요. 인식된 말을 확인하고 있어요.`);
      } else this.confirmRecognition();
    };
    // Mobile shows short activity pulses, including from actual transcripts:
    // WebKit may deliver results without delivering speechstart/speechend.
    rec.onspeechstart = () => { if (this.recognition === rec) this.showRecognitionActivity(); };
    rec.onspeechend = () => { if (this.active && this.recognition === rec && this.mobile && !this.activityTimer) this.onLevel?.(0); };
    rec.onresult = event => {
      if (this.recognition !== rec || !this.active) return;
      const transcript = Array.from(event.results, r => r[0].transcript).join('');
      if (transcript.trim()) {
        this.showRecognitionActivity();
        if (this.pendingStart) this.confirmRecognition();
      }
      const text = transcript.replace(/[^가-힣]/g, '');
      const { count, progress } = analyzeNameProgress(text, this.name);
      const calls = Math.max(0, count - highWater);
      highWater = Math.max(highWater, count);
      if (calls) this.onCalls(calls);
      if (text !== lastText) {
        clearTimeout(this.partialTimer);
        this.onProgress?.({ progress, calls });
        // A half-spoken name expires; it must not join a later, separate call.
        if (progress) this.partialTimer = setTimeout(() => this.resetRecognition(), 1500);
      }
      lastText = text;
      this.onTranscript(transcript.slice(-70));
    };
    rec.onerror = event => {
      if (this.recognition !== rec || !this.active || event.error === 'no-speech' || event.error === 'aborted') return;
      const messages = {
        'not-allowed': '음성 인식 권한이 차단됐어요. 브라우저의 사이트 설정에서 마이크를 허용한 뒤 다시 눌러주세요.',
        'service-not-allowed': this.instagram
          ? `인스타그램 안에서는 음성 인식 서비스가 허용되지 않았어요. 주소를 복사해 ${this.ios ? 'Safari' : 'Chrome'} 앱에서 열어주세요.`
          : '음성 인식 서비스가 허용되지 않았어요. 아이폰은 Safari 앱에서 열고 설정의 Siri 또는 받아쓰기를 확인해주세요. 안드로이드는 Chrome 앱에서 열어주세요.',
        'audio-capture': '마이크 입력을 시작하지 못했어요. 통화나 다른 앱의 마이크 사용을 종료한 뒤 다시 연결해주세요.',
        network: '음성 인식 서비스에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.',
        'language-not-supported': '이 브라우저의 음성 인식 서비스가 한국어를 지원하지 않아요. 다른 브라우저에서 다시 시도해주세요.'
      };
      const message = messages[event.error] || `음성 인식을 사용할 수 없어요 (${event.error || 'unknown'}). 마이크를 다시 연결해주세요.`;
      this.stop(new Error(message)); this.onStatus('error', message);
    };
    rec.onend = () => {
      rec.ended = true;
      if (this.active && this.recognition === rec && this.mobile && !this.activityTimer) this.onLevel?.(0);
      if (this.active && this.recognition === rec) this.restart = setTimeout(() => {
        if (this.active && this.recognition === rec) this.resetRecognition();
      }, 180);
    };
    return rec;
  }
  resetRecognition() {
    clearTimeout(this.partialTimer);
    this.onProgress?.({ progress: 0, calls: 0 });
    this.onTranscript?.('');
    if (!this.active || !this.recognition) return;
    clearTimeout(this.restart);
    // Replace the recognizer, keeping microphone/audio metering alive. Late
    // events from the old lobby/session cannot affect the new race session.
    const old = this.recognition;
    old.onresult = old.onstart = old.onerror = old.onend = old.onspeechstart = old.onspeechend = null;
    if (this.ios && !old.ended) {
      // Abort is asynchronous on WebKit. Wait for release before reacquiring
      // the microphone, and ignore every result from the discarded session.
      this.recognition = null;
      const generation = this.generation;
      const restart = () => {
        old.onend = null;
        if (!this.active || this.generation !== generation) return;
        clearTimeout(this.restart);
        this.restart = setTimeout(() => {
          if (!this.active || this.generation !== generation) return;
          try { this.createRecognition().start(); }
          catch { const message = '마이크를 다시 연결해주세요.'; this.stop(new Error(message)); this.onStatus('error', message); }
        }, 180);
      };
      old.onend = restart;
      this.restart = setTimeout(restart, 1000);
      try { old.abort(); } catch { restart(); }
      return;
    }
    try { old.abort(); } catch {}
    try { this.createRecognition().start(); }
    catch { const message = '마이크를 다시 연결해주세요.'; this.stop(new Error(message)); this.onStatus('error', message); }
  }
  stop(error = new Error('마이크 연결이 종료됐어요. 다시 연결해주세요.')) {
    this.generation = (this.generation || 0) + 1;
    this.active = false;
    this.awaitingFirstResult = false;
    clearTimeout(this.readyTimer); clearTimeout(this.partialTimer);
    clearTimeout(this.activityTimer); this.activityTimer = null;
    const pending = this.pendingStart; this.pendingStart = null;
    pending?.reject(error);
    clearTimeout(this.restart); cancelAnimationFrame(this.frame);
    if (this.recognition) { this.recognition.onstart = null; this.recognition.onend = null; this.recognition.onerror = null; this.recognition.onresult = null; this.recognition.onspeechstart = this.recognition.onspeechend = null; try { this.recognition.abort(); } catch {} }
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close().catch(() => {});
    try { this.sessionSource?.stop(); this.sessionSource?.disconnect(); } catch {}
    this.sessionContext?.close().catch(() => {});
    this.sessionSource = this.sessionContext = null;
    if (this.previousAudioSessionType !== undefined) {
      try { navigator.audioSession.type = this.previousAudioSessionType; } catch {}
      this.previousAudioSessionType = undefined;
    }
    this.stream = this.context = this.recognition = this.analyser = null;
    this.onLevel?.(0);
    this.onProgress?.({ progress: 0, calls: 0 });
  }
}
