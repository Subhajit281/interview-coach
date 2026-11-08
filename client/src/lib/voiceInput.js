// Microphone capture with simple energy-based voice activity detection.
// Records while armed; when speech is followed by `silenceMs` of silence, emits one utterance blob.
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export class VoiceInput {
  /** cb: { getSettings(): {silenceMs}, onLevel(rms), onSpeechStart(), onUtterance(blob, durationSec), onBargeIn(), onDiscard() } */
  constructor(cb) {
    this.cb = cb;
    this.armed = false;
    this.mode = 'capture';
  }

  async init() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    try { await this.ctx.resume(); } catch { /* resumed again in arm() */ }
    this.floor = 0.004; // adaptive noise floor
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => this.tick(), 50);
  }

  startRecorder() {
    // Each recorder owns its chunk list: a stopped recorder fires its last dataavailable asynchronously,
    // and must never leak into the next recorder's buffer (that produced corrupt audio the STT rejected).
    const chunks = [];
    const mime = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    } catch {
      rec = new MediaRecorder(this.stream);
    }
    rec._chunks = chunks;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = () => { if (this.rec === rec && this.armed && !this.finishing) { this.dropRecorder(); this.startRecorder(); } };
    this.rec = rec;
    rec.start(250);
    this.recStart = performance.now();
  }

  /** Stop and forget the current recorder without emitting anything. */
  dropRecorder() {
    const rec = this.rec;
    this.rec = null;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.onerror = null; try { rec.stop(); } catch { /* already stopped */ } }
  }

  stopRecorder() {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state === 'inactive') { resolve(null); return; }
      const done = () => {
        const type = (rec.mimeType || 'audio/webm').split(';')[0];
        resolve(new Blob(rec._chunks, { type }));
      };
      rec.onstop = done;
      try { rec.requestData(); } catch { /* not supported while stopping */ }
      try { rec.stop(); } catch { done(); }
      setTimeout(done, 2000); // safety net if onstop never fires
    });
  }

  arm(mode = 'capture') {
    if (!this.stream) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.mode = mode;
    this.speechDetected = false;
    this.barged = false;
    this.finishing = false;
    this.run = 0;
    this.voicedFrames = 0;
    this.totalVoiced = 0;
    this.lastVoice = performance.now();
    this.armed = true;
    this.dropRecorder();
    this.startRecorder();
  }

  disarm() {
    this.armed = false;
    this.dropRecorder();
  }

  tick() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    this.cb.onLevel?.(rms);
    if (!this.armed || this.finishing) return;

    const now = performance.now();
    // Adaptive noise floor (never calibrated on the user's own speech). The gate is deliberately strict so that
    // keyboard clicks, coughs, chair noise and room hum are not mistaken for an answer.
    const thr = Math.min(0.06, Math.max(0.02, this.floor * 4));
    const voiced = rms > thr;
    if (!voiced && !this.speechDetected) this.floor = this.floor * 0.95 + rms * 0.05;
    // Leaky counter: speech has tiny dips between words, a click has none of the sustain.
    if (voiced) { this.run++; this.totalVoiced++; this.lastVoice = now; if (this.speechDetected) this.voicedFrames++; }
    else this.run = Math.max(0, this.run - 2);

    // Avoid recording long stretches of silence (cost): restart the recorder while nothing is being said.
    if (!this.speechDetected && this.run === 0 && now - this.recStart > 6000) {
      this.dropRecorder(); this.startRecorder(); this.totalVoiced = 0;
    }

    if (this.mode === 'bargein') {
      if (this.run >= 14 && !this.barged) {
        this.barged = true; this.mode = 'capture';
        this.speechDetected = true; this.speechStart = now - 350;
        this.cb.onBargeIn?.();
        this.cb.onSpeechStart?.();
      }
      return;
    }

    // About 0.4 s of sustained voice before we believe it is speech.
    if (!this.speechDetected && this.run >= 8) {
      this.speechDetected = true; this.speechStart = now - 400; this.voicedFrames = this.run;
      this.cb.onSpeechStart?.();
    }
    if (this.speechDetected) {
      const silentFor = now - this.lastVoice;
      // Give people room to think mid-answer; a very short utterance ("so... um") gets extra patience.
      const need = this.cb.getSettings().silenceMs + (this.voicedFrames < 60 ? 1500 : 0);
      if (silentFor > need || now - this.speechStart > 180000) this.finish();
    }
  }

  /** "Done speaking" button. force=true sends what was recorded even if the VAD never noticed speech. */
  finishNow(force = false) {
    if (!this.armed || this.finishing) return;
    if (!this.speechDetected) {
      if (!force) return;
      // Pressing Done with nothing but silence must not send a recording (Whisper invents words from silence).
      if (this.totalVoiced < 8) { this.cb.onNothingHeard?.(); return; }
      this.speechDetected = true; this.speechStart = this.recStart; this.lastVoice = performance.now(); this.forced = true;
    }
    this.finish();
  }

  async finish() {
    if (!this.armed || this.finishing) return;
    this.finishing = true;
    const forced = this.forced; this.forced = false;
    let blob = null;
    try { blob = await this.stopRecorder(); } catch { blob = null; }
    const spoken = (this.lastVoice - this.speechStart) / 1000;
    const duration = Math.max(0.1, (performance.now() - this.recStart) / 1000);
    this.armed = false;
    this.finishing = false;
    // Less than ~0.6 s of actual voice is a cough, click or "hm", not an answer.
    const tooShort = blob && (blob.size < (forced ? 1500 : 800) || (!forced && (spoken < 0.4 || this.voicedFrames * 50 < 600)));
    if (!blob || tooShort) { this.cb.onDiscard?.(); this.arm('capture'); return; }
    this.cb.onUtterance(blob, duration, Math.max(this.voicedFrames, this.totalVoiced) * 0.05);
  }

  destroy() {
    clearInterval(this.timer);
    this.disarm();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
    this.stream = null;
  }
}
