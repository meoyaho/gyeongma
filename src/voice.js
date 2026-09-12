import { analyzeNameProgress } from './name-progress.js';

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
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('마이크를 사용하려면 HTTPS 주소 또는 localhost에서 열어주세요.');
    if (!Recognition) throw new Error('이 브라우저는 한국어 음성 인식을 지원하지 않아요. Chrome에서 열거나 키보드 체험을 선택해주세요.');
    const generation = this.generation;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { throw new Error('마이크 권한이 필요해요. 주소창의 사이트 설정에서 마이크를 허용한 뒤 다시 눌러주세요.'); }
    if (this.generation !== generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream;
    this.active = true;
    try {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      await this.context.resume();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 256;
      this.context.createMediaStreamSource(this.stream).connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const meter = () => {
        if (!this.active) return;
        this.analyser.getByteTimeDomainData(data);
        this.onLevel(Math.min(1, Math.sqrt(data.reduce((sum, x) => sum + ((x - 128) / 128) ** 2, 0) / data.length) * 5));
        this.frame = requestAnimationFrame(meter);
      };
      meter();
      this.Recognition = Recognition;
      const rec = this.createRecognition();
      await new Promise((resolve, reject) => {
        this.pendingStart = reject;
        const timeout = this.readyTimer = setTimeout(() => { this.stop(); reject(new Error('음성 인식 연결이 지연돼요. Chrome에서 다시 시도해주세요.')); }, 12000);
        const onstart = rec.onstart, onerror = rec.onerror;
        rec.onstart = () => { clearTimeout(timeout); this.pendingStart = null; onstart(); rec.onstart = onstart; resolve(); };
        rec.onerror = event => { clearTimeout(timeout); onerror(event); if (event.error !== 'no-speech') reject(new Error('음성 인식을 시작하지 못했어요. 브라우저와 마이크 권한을 확인해주세요.')); };
        rec.start();
      });
      return true;
    } catch (error) { this.stop(); throw error; }
  }
  createRecognition() {
    const rec = this.recognition = new this.Recognition();
    rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    let highWater = 0, lastText = '';
    rec.onstart = () => {
      if (this.recognition !== rec || !this.active) return;
      highWater = 0; lastText = '';
      this.onProgress?.({ progress: 0, calls: 0 });
      this.onStatus('listening', '마이크 연결됨 · 이름을 불러보세요');
    };
    rec.onresult = event => {
      if (this.recognition !== rec || !this.active) return;
      const transcript = Array.from(event.results, r => r[0].transcript).join('');
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
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? '음성 인식 권한이 차단됐어요. 브라우저의 마이크 설정을 확인해주세요.' : event.error === 'network' ? '음성 인식 서비스에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.' : '음성 인식을 사용할 수 없어요. 마이크를 다시 연결해주세요.';
      this.stop(); this.onStatus('error', message);
    };
    rec.onend = () => {
      if (this.active && this.recognition === rec) this.restart = setTimeout(() => {
        if (this.active && this.recognition === rec) this.resetRecognition();
      }, 180);
    };
    return rec;
  }
  resetRecognition() {
    clearTimeout(this.partialTimer); clearTimeout(this.restart);
    this.onProgress?.({ progress: 0, calls: 0 });
    this.onTranscript?.('');
    if (!this.active || !this.recognition) return;
    // Replace the recognizer, keeping microphone/audio metering alive. Late
    // events from the old lobby/session cannot affect the new race session.
    const old = this.recognition;
    old.onresult = old.onstart = old.onerror = old.onend = null;
    try { old.abort(); } catch {}
    try { this.createRecognition().start(); }
    catch { this.stop(); this.onStatus('error', '마이크를 다시 연결해주세요.'); }
  }
  stop() {
    this.generation = (this.generation || 0) + 1;
    this.active = false;
    clearTimeout(this.readyTimer); clearTimeout(this.partialTimer);
    if (this.pendingStart) { this.pendingStart(new Error('마이크 연결이 종료됐어요. 다시 연결해주세요.')); this.pendingStart = null; }
    clearTimeout(this.restart); cancelAnimationFrame(this.frame);
    if (this.recognition) { this.recognition.onstart = null; this.recognition.onend = null; this.recognition.onerror = null; this.recognition.onresult = null; try { this.recognition.abort(); } catch {} }
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close().catch(() => {});
    this.stream = this.context = this.recognition = null;
    this.onLevel?.(0);
    this.onProgress?.({ progress: 0, calls: 0 });
  }
}
