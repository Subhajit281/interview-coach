import test from 'node:test';
import assert from 'node:assert/strict';

// Fake MediaRecorder reproducing the real async "final dataavailable after stop()" behaviour.
class FakeRec {
  static isTypeSupported() { return true; }
  constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; this.n = FakeRec.count++; }
  start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob([`hdr${this.n}`]) }); }
  requestData() {}
  stop() {
    this.state = 'inactive';
    setTimeout(() => { this.ondataavailable?.({ data: new Blob([`tail${this.n}`]) }); this.onstop?.(); }, 5);
  }
}
FakeRec.count = 0;

test('late chunks from a stopped recorder never leak into the next recording', async () => {
  globalThis.MediaRecorder = FakeRec;
  globalThis.performance ??= { now: Date.now };
  const { VoiceInput } = await import('../../client/src/lib/voiceInput.js');
  const v = new VoiceInput({ getSettings: () => ({ silenceMs: 1000 }) });
  v.stream = {}; v.ctx = { state: 'running' };
  v.arm('capture');            // recorder 0
  v.arm('capture');            // recorder 1 (0 is dropped, its tail fires later)
  v.speechDetected = true; v.speechStart = 0; v.lastVoice = 1;
  const blob = await v.stopRecorder();
  const text = await blob.text();
  assert.equal(text, 'hdr1tail1');
  assert.equal(blob.type, 'audio/webm');
  await new Promise((r) => setTimeout(r, 20));
});
