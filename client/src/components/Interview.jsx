import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { VoiceInput } from '../lib/voiceInput.js';
import { speak, cancelSpeech, englishVoices, ttsSupported } from '../lib/tts.js';
import { Button, Card, Field, inputCls, fmtTime } from './ui.jsx';
import Visualizer from './Visualizer.jsx';
import { LANGS } from '../lib/langs.js';

// The editor and syntax highlighter are loaded on demand to keep the first load small.
const CodeEditor = lazy(() => import('./CodeEditor.jsx'));

const LABEL = {
  starting: 'Starting interview…', ai_thinking: 'Interviewer is thinking…', ai_speaking: 'Interviewer is speaking',
  ready: 'Take your time. The mic is off until you press Start answering', listening: 'Listening: answer when ready', hearing: 'Hearing you…', transcribing: 'Transcribing…',
  idle: 'Mic idle', paused: 'Paused', ending: 'Generating your report…', failed: 'Could not start',
};
const BUSY = ['starting', 'ai_thinking', 'transcribing', 'ending', 'failed'];

// autoMic is off by default: the microphone only opens when you press Start answering.
const DEFAULTS = { silenceMs: 3500, readSec: 8, idleSec: 120, rate: 1, voiceURI: '', bargeIn: false, autoMic: false };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ic.settings.v3') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
const NO_RESPONSE = '[NO RESPONSE]';
function loadEditorPrefs() {
  try { return { highlightOn: true, lang: 'python', ...JSON.parse(localStorage.getItem('ic.editor') || '{}') }; }
  catch { return { highlightOn: true, lang: 'python' }; }
}

function Clock({ elapsedRef, isRunning, totalSec }) {
  const [sec, setSec] = useState(0);
  // The ticking lives here so the rest of the screen (and the code editor) does not re-render every second.
  useEffect(() => {
    const t = setInterval(() => { if (isRunning()) { elapsedRef.current += 1; setSec(elapsedRef.current); } }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remaining = totalSec - sec;
  return (
    <div className="flex items-baseline justify-between">
      <div className={`text-3xl font-semibold tabular-nums ${remaining < 0 ? 'text-red-400' : remaining < 120 ? 'text-amber-400' : ''}`}>
        {remaining < 0 ? '+' : ''}{fmtTime(remaining)}
      </div>
      <div className="text-xs text-neutral-500">{remaining < 0 ? 'overtime' : 'remaining'}</div>
    </div>
  );
}

export default function Interview({ cfg, meta, onFinished, onExit }) {
  const [messages, setMessages] = useState([]);
  const [board, setBoard] = useState('');
  const [phase, setPhaseState] = useState('starting');
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [editor, setEditor] = useState(loadEditorPrefs);
  const [settings, setSettings] = useState(loadSettings);
  const [voices, setVoices] = useState([]);
  const [micOk, setMicOk] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [hasPendingAudio, setHasPendingAudio] = useState(false);
  const pendingAudio = useRef(null);

  const phaseRef = useRef('starting');
  const go = (p) => { phaseRef.current = p; setPhaseState(p); };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const idRef = useRef(null);
  const voiceRef = useRef(null);
  const micRef = useRef(false);
  const levelRef = useRef(0);
  const lastSay = useRef('');
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const handlers = useRef({});
  const scrollRef = useRef(null);
  const readTimer = useRef(null);
  const idleTimer = useRef(null);
  const activityRef = useRef(0);
  const endAfterSpeech = useRef(false);
  const lastBoardRef = useRef('');

  const clearTimers = () => {
    clearTimeout(readTimer.current); readTimer.current = null;
    clearTimeout(idleTimer.current); idleTimer.current = null;
  };

  // Nobody answered for a long while: tell the interviewer so it can rephrase or move on. Never fires while the person is typing.
  const armIdle = (ms) => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (phaseRef.current !== 'listening') return;
      if (Date.now() - activityRef.current < 45000) { armIdle(20000); return; }
      sendTurn(NO_RESPONSE);
    }, ms);
  };

  const beginListening = () => {
    clearTimers();
    if (!voiceRef.current || !micRef.current) { go('idle'); return; }
    voiceRef.current.arm('capture');
    go('listening');
    // More thinking time when a problem statement is on the board.
    const boardWords = lastBoardRef.current ? lastBoardRef.current.split(/\s+/).length : 0;
    armIdle(settingsRef.current.idleSec * 1000 + Math.min(120000, boardWords * 500));
  };

  // After the interviewer finishes speaking, the mic stays OFF until the candidate presses Start answering.
  // Only when the optional auto-start setting is on does the mic open by itself after a reading delay.
  const startReading = () => {
    clearTimers();
    voiceRef.current?.disarm();
    if (endAfterSpeech.current) { endAfterSpeech.current = false; setTimeout(() => doEnd(), 1500); return; }
    go('ready');
    if (micRef.current && settingsRef.current.autoMic) {
      const boardWords = lastBoardRef.current ? lastBoardRef.current.split(/\s+/).length : 0;
      const ms = settingsRef.current.readSec * 1000 + Math.min(30000, boardWords * 300);
      readTimer.current = setTimeout(() => { if (phaseRef.current === 'ready') beginListening(); }, ms);
    }
  };

  const speakReply = (say) => {
    clearTimers();
    go('ai_speaking');
    if (micRef.current && settingsRef.current.bargeIn) voiceRef.current.arm('bargein');
    else voiceRef.current?.disarm();
    speak(say, settingsRef.current, () => { if (phaseRef.current === 'ai_speaking') startReading(); });
  };

  const applyReply = (r) => {
    setMessages((m) => [...m, { role: 'interviewer', content: r.say, board: r.board }]);
    if (r.board) setBoard(r.board);
    lastBoardRef.current = r.board || '';
    if (r.wrapUp) setWrap(true);
    endAfterSpeech.current = r.endInterview === true;
    lastSay.current = r.say;
    speakReply(r.say);
  };

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 6000); };

  // Never throws: failures become a banner with a Retry button (the candidate message is already saved server-side).
  const sendTurn = async (userText) => {
    clearTimers();
    voiceRef.current?.disarm();
    cancelSpeech();
    if (userText) setMessages((m) => [...m, { role: 'candidate', content: userText }]);
    go('ai_thinking');
    setError('');
    setCanRetry(false);
    try {
      const r = await api.turn(idRef.current, { text: userText || undefined, elapsedSec: elapsedRef.current });
      if (r.ignored) {
        // A stray word is not an answer: nothing changes, the question stands and the candidate keeps their time.
        if (userText) setMessages((m) => (m.length && m[m.length - 1].role === 'candidate' && m[m.length - 1].content === userText ? m.slice(0, -1) : m));
        flash('That looked like a stray word rather than an answer, so it was ignored. The question has not changed.');
        go('ready');
        return;
      }
      applyReply(r);
    } catch (e) {
      setError(e.message);
      setCanRetry(true);
      go('idle');
    }
  };

  handlers.current = {
    speechStart: () => { if (['listening', 'ai_speaking'].includes(phaseRef.current)) { clearTimeout(idleTimer.current); go('hearing'); } },
    barge: () => { cancelSpeech(); go('hearing'); },
    utterance: async (blob, dur, voiced) => {
      go('transcribing');
      setError('');
      // Keep the recording until it is transcribed, so a failed request never loses the answer.
      pendingAudio.current = { blob, dur, voiced };
      setHasPendingAudio(true);
      try {
        const { text: t } = await api.transcribe(blob, dur, voiced);
        pendingAudio.current = null;
        setHasPendingAudio(false);
        if (!t) { beginListening(); return; } // noise or a stray sound: ignore it quietly
        await sendTurn(t);
      } catch (e) {
        setError(`Transcription failed: ${e.message} Your recording is kept: press Retry transcription, or type your answer.`);
        go('idle');
      }
    },
    nothingHeard: () => { setError('Nothing heard yet. Speak when you are ready.'); setTimeout(() => setError((e) => (e.startsWith('Nothing heard') ? '' : e)), 3000); },
    discard: () => { /* a click, cough or short sound: ignored silently, the mic is already re-armed */ },
  };

  useEffect(() => {
    if (startedRef.current) return undefined;
    startedRef.current = true;
    const v = new VoiceInput({
      getSettings: () => settingsRef.current,
      onLevel: (x) => { levelRef.current = x; },
      onSpeechStart: () => handlers.current.speechStart(),
      onUtterance: (b, d, v) => handlers.current.utterance(b, d, v),
      onBargeIn: () => handlers.current.barge(),
      onDiscard: () => handlers.current.discard(),
      onNothingHeard: () => handlers.current.nothingHeard(),
    });
    voiceRef.current = v;
    (async () => {
      try { await v.init(); micRef.current = true; }
      catch (e) { micRef.current = false; setMicOk(false); setError(`Microphone unavailable (${e.message}). Text mode only.`); }
      try {
        const r = await api.start(cfg);
        idRef.current = r.interview.id;
        setMessages([{ role: 'interviewer', content: r.message.say, board: r.message.board }]);
        if (r.message.board) setBoard(r.message.board);
        lastBoardRef.current = r.message.board || '';
        lastSay.current = r.message.say;
        speakReply(r.message.say);
      } catch (e) { setError(e.message); go('failed'); }
    })();
    return () => { clearTimers(); cancelSpeech(); v.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ttsSupported()) return undefined;
    const load = () => setVoices(englishVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, phase]);
  useEffect(() => { localStorage.setItem('ic.settings.v3', JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem('ic.editor', JSON.stringify(editor)); }, [editor]);

  const pause = async () => {
    clearTimers(); cancelSpeech(); voiceRef.current?.disarm(); go('paused');
    try { await api.pause(idRef.current); } catch (e) { setError(e.message); }
  };
  const resume = async () => {
    try { await api.resume(idRef.current); } catch (e) { setError(e.message); return; }
    setError('');
    speakReply(lastSay.current || 'Let us continue.');
  };
  const repeat = () => { voiceRef.current?.disarm(); speakReply(lastSay.current); };
  const interrupt = () => { cancelSpeech(); beginListening(); };
  const startAnswering = () => beginListening();
  const doEnd = async () => {
    clearTimers(); cancelSpeech(); voiceRef.current?.disarm(); go('ending'); setError('');
    try { onFinished(await api.end(idRef.current, elapsedRef.current)); }
    catch (e) { setError(e.message); go('idle'); }
  };
  // The only manual way out: the End interview button. Nothing you say ends the session.
  const end = () => { if (window.confirm('End the interview and generate the report?')) doEnd(); };
  const retryAudio = () => {
    const a = pendingAudio.current;
    if (a) handlers.current.utterance(a.blob, a.dur, a.voiced);
  };
  const submitText = () => { const t = text.trim(); if (!t) return; setText(''); pendingAudio.current = null; setHasPendingAudio(false); sendTurn(t); };
  const submitCode = () => { if (!code.trim()) return; sendTurn(`[CODE] (${editor.lang})\n${code.trim()}`); };

  const isRunning = () => Boolean(idRef.current) && !['starting', 'paused', 'ending', 'failed'].includes(phaseRef.current);
  const vizMode = phase === 'hearing' || phase === 'listening' ? 'user' : phase === 'ai_speaking' ? 'ai' : 'idle';
  const canType = !BUSY.includes(phase) && phase !== 'paused';
  const onCodeChange = useCallback((v) => { activityRef.current = Date.now(); setCode(v); }, []);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  let primary = { label: 'Start answering', onClick: startAnswering, disabled: !micOk || BUSY.includes(phase) || phase === 'paused' };
  if (phase === 'hearing') primary = { label: 'Done speaking', onClick: () => voiceRef.current.finishNow(true), disabled: false };
  else if (phase === 'listening') primary = { label: 'Done speaking', onClick: () => voiceRef.current.finishNow(true), disabled: false };
  else if (phase === 'ai_speaking') primary = { label: 'Interrupt and answer', onClick: interrupt, disabled: false };
  else if (phase === 'ready') primary = { label: 'Start answering', onClick: startAnswering, disabled: false };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card title={`${meta.modes.find((m) => m.id === cfg.mode)?.label} · ${meta.companies.find((c) => c.id === cfg.company)?.name} · ${cfg.personality}`}>
          <div ref={scrollRef} className="h-[52vh] space-y-3 overflow-y-auto pr-1 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'candidate' ? 'text-right' : ''}>
                <div className="mb-0.5 text-xs uppercase tracking-wide text-neutral-500">{m.role === 'candidate' ? 'You' : 'Interviewer'}</div>
                {m.content === NO_RESPONSE ? (
                  <p className="inline-block text-xs italic text-neutral-500">(no response)</p>
                ) : m.content.startsWith('[CODE]') ? (
                  <pre className="inline-block max-w-full overflow-x-auto rounded bg-neutral-950 p-2 text-left text-xs text-neutral-200">{m.content.replace(/^\[CODE\][^\n]*\n/, '')}</pre>
                ) : (
                  <p className={`inline-block max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-left ${m.role === 'candidate' ? 'bg-neutral-800' : 'bg-neutral-950 border border-neutral-800'}`}>{m.content}</p>
                )}
              </div>
            ))}
            {(phase === 'ai_thinking' || phase === 'transcribing' || phase === 'starting') && <div className="text-xs text-neutral-500">{LABEL[phase]}</div>}
          </div>
          {notice && <div className="mt-3 rounded border border-amber-900 bg-amber-950/40 p-2 text-sm text-amber-200">{notice}</div>}
          {error && (
            <div className="mt-3 rounded border border-red-900 bg-red-950/60 p-2 text-sm text-red-200">
              {error}
              {hasPendingAudio && phase === 'idle' && <Button className="ml-3" onClick={retryAudio}>Retry transcription</Button>}
              {canRetry && <Button className="ml-3" onClick={() => sendTurn('')}>Retry</Button>}
              {phase === 'failed' && <Button className="ml-3" onClick={onExit}>Back</Button>}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <input
              className={inputCls} placeholder="Or type your answer…" value={text} disabled={!canType}
              onChange={(e) => { activityRef.current = Date.now(); setText(e.target.value); }} onKeyDown={(e) => e.key === 'Enter' && submitText()}
            />
            <Button onClick={submitText} disabled={!canType || !text.trim()}>Send</Button>
          </div>
        </Card>

        <Card title="Code / notes" right={
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <select className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5" value={editor.lang} onChange={(e) => setEditor((s) => ({ ...s, lang: e.target.value }))}>
              {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={editor.highlightOn} onChange={(e) => setEditor((s) => ({ ...s, highlightOn: e.target.checked }))} /> Colors
            </label>
          </div>
        }>
          <Suspense fallback={<div className="h-40 rounded border border-neutral-700 bg-neutral-950" />}>
            <CodeEditor value={code} onChange={onCodeChange} lang={editor.lang} highlightOn={editor.highlightOn} />
          </Suspense>
          <p className="mt-1 text-xs text-neutral-500">Brackets and quotes auto-close. Tab indents, Shift+Tab outdents, Esc then Tab leaves the editor.</p>
          <div className="mt-2"><Button onClick={submitCode} disabled={!canType || !code.trim()}>Send code</Button></div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <Clock elapsedRef={elapsedRef} isRunning={isRunning} totalSec={cfg.durationMin * 60} />
          {wrap && <div className="mt-1 text-xs text-amber-400">The interviewer is wrapping up.</div>}
          <div className="mt-3"><Visualizer levelRef={levelRef} mode={vizMode} /></div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${phase === 'listening' || phase === 'hearing' ? 'bg-emerald-400' : phase === 'ai_speaking' ? 'bg-sky-400' : phase === 'ready' ? 'bg-amber-400' : 'bg-neutral-600'}`} />
            <span>{LABEL[phase]}</span>
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Mic: {micOk ? (phase === 'listening' || phase === 'hearing' ? 'on' : 'off') : 'unavailable'} · Interviewer: {phase === 'ai_speaking' ? 'speaking' : 'quiet'}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="primary" className="col-span-2" onClick={primary.onClick} disabled={primary.disabled}>{primary.label}</Button>
            <Button onClick={repeat} disabled={BUSY.includes(phase) || !lastSay.current}>Repeat question</Button>
            {phase === 'paused'
              ? <Button onClick={resume}>Resume</Button>
              : <Button onClick={pause} disabled={BUSY.includes(phase)}>Pause</Button>}
            <Button variant="danger" className="col-span-2" onClick={end} disabled={['starting', 'ending', 'failed'].includes(phase)}>End interview</Button>
          </div>
        </Card>

        <Card title="Problem / board">
          {board ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-neutral-200">{board}</pre>
            : <p className="text-sm text-neutral-500">Problem statements and schemas will appear here.</p>}
        </Card>

        <details className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <summary className="cursor-pointer text-neutral-300">Voice settings</summary>
          <div className="mt-3 space-y-3">
            <Field label={`Pause tolerance: ${(settings.silenceMs / 1000).toFixed(1)}s`} hint="How long you can be silent mid-answer before it is sent. Raise it if you get cut off while thinking.">
              <input type="range" min="2000" max="8000" step="250" value={settings.silenceMs} onChange={(e) => set('silenceMs', Number(e.target.value))} className="w-full" />
            </Field>
            <label className="flex items-start gap-2 text-neutral-300">
              <input type="checkbox" className="mt-1" checked={settings.autoMic} onChange={(e) => set('autoMic', e.target.checked)} />
              <span>Open the microphone automatically after a reading delay (off by default: the mic only opens when you press Start answering)</span>
            </label>
            {settings.autoMic && (
              <Field label={`Reading delay: ${settings.readSec}s`} hint="How long the mic stays off after each question before it opens by itself (longer automatically when a problem is on the board).">
                <input type="range" min="3" max="60" step="1" value={settings.readSec} onChange={(e) => set('readSec', Number(e.target.value))} className="w-full" />
              </Field>
            )}
            <Field label={`Silence before the interviewer follows up: ${settings.idleSec}s`} hint="Only counts once the mic is on. Typing in the answer or code box pauses it.">
              <input type="range" min="30" max="300" step="5" value={settings.idleSec} onChange={(e) => set('idleSec', Number(e.target.value))} className="w-full" />
            </Field>
            <Field label={`Speech rate: ${settings.rate.toFixed(1)}x`}>
              <input type="range" min="0.8" max="1.4" step="0.1" value={settings.rate} onChange={(e) => set('rate', Number(e.target.value))} className="w-full" />
            </Field>
            <Field label="Interviewer voice">
              <select className={inputCls} value={settings.voiceURI} onChange={(e) => set('voiceURI', e.target.value)}>
                <option value="">Browser default</option>
                {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
              </select>
            </Field>
            <label className="flex items-start gap-2 text-neutral-300">
              <input type="checkbox" className="mt-1" checked={settings.bargeIn} onChange={(e) => set('bargeIn', e.target.checked)} />
              <span>Talk over the interviewer to interrupt (use headphones, otherwise speaker audio can trigger it)</span>
            </label>
          </div>
        </details>
      </div>
    </div>
  );
}
