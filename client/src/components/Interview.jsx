import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { createStartKey, INTERVIEW_START_TIMEOUT_MS, isAbort, isTemporaryStartError, sleep } from '../lib/connection.js';
import { VoiceInput } from '../lib/voiceInput.js';
import { speak, cancelSpeech, englishVoices, ttsSupported, detectGenderFromText } from '../lib/tts.js';
import { Button, Card, Field, inputCls, Badge, EqualizerLoader, ConfirmModal, fmtTime } from './ui.jsx';
import Visualizer from './Visualizer.jsx';
import { useModelGate } from './ModelPicker.jsx';
import { LANGS } from '../lib/langs.js';

const CodeEditor = lazy(() => import('./CodeEditor.jsx'));

const LABEL = {
  starting: 'Connecting to your interviewer…',
  ai_thinking: 'Interviewer is thinking…',
  ai_speaking: 'Interviewer is speaking',
  ready: 'Mic is off. Click "Start answering" when ready to speak',
  listening: 'Listening… speak your answer clearly',
  hearing: 'Detecting speech…',
  transcribing: 'Transcribing speech to text…',
  idle: 'Mic idle',
  paused: 'Interview paused',
  model_wait: 'Paused. Choose a new AI model to continue',
  ending: 'Generating comprehensive evaluation report…',
  failed: 'Could not connect to interview session',
};

const BUSY = ['starting', 'ai_thinking', 'transcribing', 'ending', 'failed', 'model_wait'];

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
  useEffect(() => {
    const t = setInterval(() => {
      if (isRunning()) {
        elapsedRef.current += 1;
        setSec(elapsedRef.current);
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remaining = totalSec - sec;
  const isOvertime = remaining < 0;

  return (
    <div className="flex items-center justify-between rounded-[6px] border border-[#16231a] bg-[#070b08] px-3.5 py-2">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Time remaining</div>
        <div
          className={`font-mono text-2xl font-bold tracking-tight tabular-nums ${
            isOvertime
              ? 'text-rose-400'
              : remaining < 180
              ? 'text-amber-400'
              : 'text-neutral-100'
          }`}
        >
          {isOvertime ? '+' : ''}
          {fmtTime(remaining)}
        </div>
      </div>
      <Badge variant={isOvertime ? 'red' : remaining < 180 ? 'amber' : 'emerald'}>
        {isOvertime ? 'Overtime' : 'Active'}
      </Badge>
    </div>
  );
}

export default function Interview({ cfg, meta, onFinished, onExit }) {
  const [messages, setMessages] = useState([]);
  const [board, setBoard] = useState('');
  const [phase, setPhaseState] = useState('starting');
  const [error, setError] = useState('');
  const [canRetry, setCanRetry] = useState(false);
  const [modelBlocked, setModelBlocked] = useState(false);
  const { guard } = useModelGate();
  const [notice, setNotice] = useState('');
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [editor, setEditor] = useState(loadEditorPrefs);
  const [settings, setSettings] = useState(loadSettings);
  const [voices, setVoices] = useState([]);
  const [micOk, setMicOk] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [activeTab, setActiveTab] = useState('problem'); // 'problem' | 'chat' | 'split'
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [hasPendingAudio, setHasPendingAudio] = useState(false);
  const [interviewerInfo, setInterviewerInfo] = useState(null);
  const [connectionState, setConnectionState] = useState('starting');
  const [connectionSeconds, setConnectionSeconds] = useState(0);
  const interviewerGender = useRef(null);
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
  const startAbortRef = useRef(null);
  const startInFlightRef = useRef(false);
  const startKeyRef = useRef(createStartKey());
  const mountedRef = useRef(true);

  const clearTimers = () => {
    clearTimeout(readTimer.current); readTimer.current = null;
    clearTimeout(idleTimer.current); idleTimer.current = null;
  };

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
    const boardWords = lastBoardRef.current ? lastBoardRef.current.split(/\s+/).length : 0;
    armIdle(settingsRef.current.idleSec * 1000 + Math.min(120000, boardWords * 500));
  };

  const startReading = () => {
    clearTimers();
    voiceRef.current?.disarm();
    if (endAfterSpeech.current) {
      endAfterSpeech.current = false;
      setTimeout(() => doEnd(), 1500);
      return;
    }
    go('ready');
    if (micRef.current && settingsRef.current.autoMic) {
      const boardWords = lastBoardRef.current ? lastBoardRef.current.split(/\s+/).length : 0;
      const ms = settingsRef.current.readSec * 1000 + Math.min(30000, boardWords * 300);
      readTimer.current = setTimeout(() => { if (phaseRef.current === 'ready') beginListening(); }, ms);
    }
  };

  const speakReply = (say, info = null) => {
    clearTimers();
    go('ai_speaking');
    if (micRef.current && settingsRef.current.bargeIn) voiceRef.current.arm('bargein');
    else voiceRef.current?.disarm();
    const g = info?.gender || interviewerGender.current || detectGenderFromText(say);
    if (g && !interviewerGender.current) interviewerGender.current = g;
    speak(say, { ...settingsRef.current, gender: g }, () => { if (phaseRef.current === 'ai_speaking') startReading(); });
  };

  const applyReply = (r) => {
    setMessages((m) => [...m, { role: 'interviewer', content: r.say, board: r.board }]);
    if (r.board) {
      setBoard(r.board);
      // Auto-switch to problem view so user sees new problem immediately
      setActiveTab('problem');
    }
    lastBoardRef.current = r.board || '';
    if (r.wrapUp) setWrap(true);
    endAfterSpeech.current = r.endInterview === true;
    lastSay.current = r.say;
    if (r.interviewer) {
      setInterviewerInfo(r.interviewer);
      interviewerGender.current = r.interviewer.gender;
    }
    speakReply(r.say, r.interviewer);
  };

  // The server keeps this key with the session. Retrying after a browser or proxy
  // timeout therefore returns the original first question instead of creating one more interview.
  const startSession = async () => {
    if (startInFlightRef.current || idRef.current || !mountedRef.current) return;
    startInFlightRef.current = true;
    const controller = new AbortController();
    startAbortRef.current?.abort();
    startAbortRef.current = controller;
    const deadline = Date.now() + INTERVIEW_START_TIMEOUT_MS;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(new DOMException('Interview initialization timed out', 'AbortError')); }, INTERVIEW_START_TIMEOUT_MS);
    const keepAwake = setInterval(() => { api.health().catch(() => {}); }, 5_000);
    go('starting');
    setConnectionState('starting');
    setConnectionSeconds(0);
    setError('');
    setCanRetry(false);
    setModelBlocked(false);
    try {
      let result;
      while (Date.now() < deadline && !controller.signal.aborted) {
        try {
          result = await guard(() => api.start(cfg, { signal: controller.signal, idempotencyKey: startKeyRef.current }), { onWait: () => setError('') });
          break;
        } catch (e) {
          if (!isTemporaryStartError(e) || Date.now() >= deadline || controller.signal.aborted) throw e;
          // A 5xx can be a still-warming Render proxy or provider. The server-side key
          // makes this safe even if the prior response was lost after it completed.
          await sleep(Math.min(2_500, deadline - Date.now()), controller.signal);
        }
      }
      if (!result) throw new DOMException('Interview initialization timed out', 'AbortError');
      if (!mountedRef.current) return;
      idRef.current = result.interview.id;
      const ivInfo = result.interviewer || result.message?.interviewer;
      if (ivInfo) {
        setInterviewerInfo(ivInfo);
        interviewerGender.current = ivInfo.gender;
      }
      setMessages([{ role: 'interviewer', content: result.message.say, board: result.message.board }]);
      if (result.message.board) setBoard(result.message.board);
      lastBoardRef.current = result.message.board || '';
      lastSay.current = result.message.say;
      setConnectionState('connected');
      speakReply(result.message.say, ivInfo);
    } catch (e) {
      if (!mountedRef.current) return;
      const message = timedOut || isAbort(e)
        ? 'The interviewer did not finish initializing within 90 seconds. Your request may still be completing safely; retry uses the same session request.'
        : e.message;
      setError(message);
      setConnectionState('failed');
      setCanRetry(true);
      setModelBlocked(Boolean(e.modelDeclined));
      go('failed');
    } finally {
      clearTimeout(timeout);
      clearInterval(keepAwake);
      if (startAbortRef.current === controller) startAbortRef.current = null;
      startInFlightRef.current = false;
    }
  };

  const flash = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 6000);
  };

  const sendTurn = async (userText) => {
    clearTimers();
    voiceRef.current?.disarm();
    cancelSpeech();
    if (userText) setMessages((m) => [...m, { role: 'candidate', content: userText }]);
    go('ai_thinking');
    setError('');
    setCanRetry(false);
    setModelBlocked(false);
    try {
      // If the model's limit is hit, the interview waits here (clock stopped, answer kept) until a new model is mounted.
      // The answer is stored server-side by the first attempt, so retries send no text (nothing is duplicated).
      let resend = true;
      const r = await guard(
        async () => {
          try { return await api.turn(idRef.current, { text: resend ? userText || undefined : undefined, elapsedSec: elapsedRef.current }); }
          catch (e) { resend = e.code === 'MODEL_INVALID'; throw e; }
        },
        { onWait: () => { setError(''); go('model_wait'); }, onResume: () => go('ai_thinking') },
      );
      if (r.ignored) {
        if (userText) setMessages((m) => (m.length && m[m.length - 1].role === 'candidate' && m[m.length - 1].content === userText ? m.slice(0, -1) : m));
        flash('Ambient sound detected and ignored. Your time and question are preserved.');
        go('ready');
        return;
      }
      applyReply(r);
    } catch (e) {
      setError(e.message);
      setCanRetry(true);
      setModelBlocked(Boolean(e.modelDeclined));
      go('idle');
    }
  };

  handlers.current = {
    speechStart: () => { if (['listening', 'ai_speaking'].includes(phaseRef.current)) { clearTimeout(idleTimer.current); go('hearing'); } },
    barge: () => { cancelSpeech(); go('hearing'); },
    utterance: async (blob, dur, voiced) => {
      go('transcribing');
      setError('');
      pendingAudio.current = { blob, dur, voiced };
      setHasPendingAudio(true);
      try {
        const { text: t } = await api.transcribe(blob, dur, voiced);
        pendingAudio.current = null;
        setHasPendingAudio(false);
        if (!t) { beginListening(); return; }
        await sendTurn(t);
      } catch (e) {
        setError(`Transcription issue: ${e.message}. You can retry or type below.`);
        go('idle');
      }
    },
    nothingHeard: () => {
      setError('Silence detected. Take your time or speak when ready.');
      setTimeout(() => setError((e) => (e.startsWith('Silence detected') ? '' : e)), 3000);
    },
    discard: () => {},
  };

  useEffect(() => {
    if (startedRef.current) return undefined;
    startedRef.current = true;
    mountedRef.current = true;
    const v = new VoiceInput({
      getSettings: () => settingsRef.current,
      onLevel: (x) => { levelRef.current = x; },
      onSpeechStart: () => handlers.current.speechStart(),
      onUtterance: (b, d, voiced) => handlers.current.utterance(b, d, voiced),
      onBargeIn: () => handlers.current.barge(),
      onDiscard: () => handlers.current.discard(),
      onNothingHeard: () => handlers.current.nothingHeard(),
    });
    voiceRef.current = v;
    (async () => {
      try {
        await v.init();
        micRef.current = true;
      } catch (e) {
        micRef.current = false;
        setMicOk(false);
        setError(`Microphone unavailable (${e.message}). You can type your answers.`);
      }
    })();
    // Mic permission is optional; do not make it delay the Render/LLM connection.
    startSession();
    return () => { mountedRef.current = false; startAbortRef.current?.abort(); clearTimers(); cancelSpeech(); v.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ttsSupported()) return undefined;
    const load = () => setVoices(englishVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, phase]);

  useEffect(() => {
    if (connectionState !== 'starting') return undefined;
    const timer = setInterval(() => setConnectionSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connectionState]);

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
    try {
      onFinished(await guard(async () => {
        const r = await api.end(idRef.current, elapsedRef.current);
        // After a model switch the interview is already saved as completed, so only the report is missing.
        return !r.report && !r.note ? { ...r, report: (await api.regenerateReport(idRef.current)).report } : r;
      }));
    } catch (e) { setError(e.message); setModelBlocked(Boolean(e.modelDeclined)); go('idle'); }
  };

  const end = () => setShowEndConfirm(true);

  const retryAudio = () => {
    const a = pendingAudio.current;
    if (a) handlers.current.utterance(a.blob, a.dur, a.voiced);
  };

  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    pendingAudio.current = null;
    setHasPendingAudio(false);
    sendTurn(t);
  };

  const submitCode = () => {
    if (!code.trim()) return;
    sendTurn(`[CODE] (${editor.lang})\n${code.trim()}`);
  };

  const isRunning = () => Boolean(idRef.current) && !['starting', 'paused', 'ending', 'failed', 'model_wait'].includes(phaseRef.current);
  const vizMode = phase === 'hearing' || phase === 'listening' ? 'user' : phase === 'ai_speaking' ? 'ai' : 'idle';
  const canType = !BUSY.includes(phase) && phase !== 'paused';
  const onCodeChange = useCallback((v) => { activityRef.current = Date.now(); setCode(v); }, []);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  let primary = { label: 'Start answering', onClick: startAnswering, disabled: !micOk || BUSY.includes(phase) || phase === 'paused' };
  if (phase === 'hearing' || phase === 'listening') {
    primary = { label: 'Done speaking', onClick: () => voiceRef.current?.finishNow(true), disabled: false };
  } else if (phase === 'ai_speaking') {
    primary = { label: 'Interrupt & answer', onClick: interrupt, disabled: false };
  } else if (phase === 'ready') {
    primary = { label: 'Start answering', onClick: startAnswering, disabled: false };
  }

  const modeObj = meta?.modes?.find((m) => m.id === cfg.mode);
  const compObj = meta?.companies?.find((c) => c.id === cfg.company);

  // Latest interviewer question
  const lastInterviewerMsg = [...messages].reverse().find((m) => m.role === 'interviewer');

  return (
    <div className="space-y-3">
      {/* Top Session Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#16231a] bg-[#0a0f0c] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            {modeObj?.label || cfg.mode} · {compObj?.name || cfg.company} · {cfg.round}
          </span>
          {interviewerInfo?.name && (
            <Badge variant="emerald" className="font-mono text-[10px]">
              {interviewerInfo.name} ({interviewerInfo.gender})
            </Badge>
          )}
          <Badge variant="emerald" className="font-mono text-[10px]">
            {cfg.personality}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-neutral-400">
            Phase: <span className="font-medium text-emerald-400">{phase.toUpperCase()}</span>
          </span>
          <Badge variant={connectionState === 'failed' ? 'red' : connectionState === 'connected' ? 'emerald' : 'amber'} className="font-mono text-[10px]">
            {connectionState.toUpperCase()}
          </Badge>
          <Button variant="danger" className="text-xs px-2.5 py-1" onClick={end} disabled={['starting', 'ending', 'failed'].includes(phase)}>
            End Session
          </Button>
        </div>
      </div>

      {connectionState !== 'connected' && (
        <div className={`rounded-lg border p-5 text-center ${connectionState === 'failed' ? 'border-red-900/60 bg-red-950/30' : 'border-[#1c3b29] bg-[#08110c]'}`}>
          {connectionState === 'starting' ? (
            <>
              <EqualizerLoader size="md" label="Waking up the interviewer and preparing your interview session…" />
              <h2 className="mt-4 text-sm font-semibold text-neutral-100">Connecting to your interviewer…</h2>
              <p className="mt-1 text-xs text-neutral-400">This may take up to 90 seconds while the server and AI model initialize. {connectionSeconds}s elapsed.</p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-red-100">Interview connection failed</h2>
              <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-red-200">{error || 'The interviewer could not be initialized.'}</p>
              <Button variant="default" className="mt-4 text-xs" onClick={startSession}>Retry connection</Button>
            </>
          )}
        </div>
      )}

      {/* Main Split Grid: Left = Problem & Chat, Right = Code & HUD */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left Column (5 Cols on large): DSA Problem Statement & Discussion */}
        <div className="space-y-3 lg:col-span-5 flex flex-col">
          {/* Tab controls */}
          <div className="flex items-center justify-between border-b border-[#16231a] pb-1">
            <div className="flex items-center gap-1">
              <button
                className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === 'problem'
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                onClick={() => setActiveTab('problem')}
              >
                Problem Statement {board ? '★' : ''}
              </button>
              <button
                className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeTab === 'chat'
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                onClick={() => setActiveTab('chat')}
              >
                Interview Discussion ({messages.length})
              </button>
              <button
                className={`hidden sm:inline-block rounded-[4px] px-2.5 py-1.5 text-xs font-medium transition-all ${
                  activeTab === 'split'
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                onClick={() => setActiveTab('split')}
              >
                Split View
              </button>
            </div>
            {board && (
              <Button
                variant="ghost"
                className="px-2 py-0.5 text-xs text-neutral-400 hover:text-white"
                onClick={() => navigator.clipboard?.writeText(board)}
              >
                Copy problem
              </Button>
            )}
          </div>

          {/* Problem Statement Card View */}
          {(activeTab === 'problem' || activeTab === 'split') && (
            <Card
              title="Problem Statement & Specifications"
              className={activeTab === 'split' ? 'flex-1' : 'flex-1 min-h-[460px]'}
            >
              {board ? (
                <div className="h-full max-h-[56vh] overflow-y-auto pr-1">
                  <pre className="font-mono text-xs leading-relaxed text-neutral-200 whitespace-pre-wrap bg-[#070b08] p-3.5 rounded-[6px] border border-[#16231a]">
                    {board}
                  </pre>
                </div>
              ) : (
                <div className="flex h-56 flex-col items-center justify-center text-center p-4">
                  <p className="text-sm font-medium text-neutral-300">Awaiting Problem Statement</p>
                  <p className="mt-1 text-xs text-neutral-400 max-w-sm leading-relaxed">
                    Once the interviewer outlines your coding problem or system architecture question, the complete description, examples, and constraints will appear in this pane.
                  </p>
                </div>
              )}

              {/* Latest question preview bar when on problem tab */}
              {lastInterviewerMsg && (
                <div className="mt-3 rounded-[6px] border border-[#16231a] bg-[#070b08] p-2.5 text-xs">
                  <span className="font-semibold text-emerald-400 block mb-0.5">Current Prompt:</span>
                  <p className="text-neutral-300 line-clamp-3 leading-relaxed">{lastInterviewerMsg.content}</p>
                </div>
              )}
            </Card>
          )}

          {/* Conversation Chat Stream View */}
          {(activeTab === 'chat' || activeTab === 'split') && (
            <Card
              title="Interview Conversation Stream"
              className={activeTab === 'split' ? 'flex-1' : 'flex-1 min-h-[460px]'}
            >
              <div
                ref={scrollRef}
                className="h-[44vh] space-y-3 overflow-y-auto pr-1 text-xs leading-relaxed"
              >
                {messages.map((m, i) => {
                  const isUser = m.role === 'candidate';
                  return (
                    <div key={i} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                      <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                        {isUser ? 'You' : 'Interviewer'}
                      </span>
                      {m.content === NO_RESPONSE ? (
                        <p className="rounded-[4px] border border-[#16231a] bg-[#070b08] px-2.5 py-1 text-xs italic text-neutral-400">
                          (no response)
                        </p>
                      ) : m.content.startsWith('[CODE]') ? (
                        <pre className="max-w-[90%] overflow-x-auto rounded-[6px] border border-[#16231a] bg-[#070b08] p-2.5 font-mono text-xs text-neutral-200">
                          {m.content.replace(/^\[CODE\][^\n]*\n/, '')}
                        </pre>
                      ) : (
                        <div
                          className={`max-w-[85%] rounded-[6px] px-3 py-2 ${
                            isUser
                              ? 'border border-emerald-700/50 bg-[#0e1a12] text-emerald-100'
                              : 'border border-[#16231a] bg-[#070b08] text-neutral-200'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                {(phase === 'ai_thinking' || phase === 'transcribing' || phase === 'starting') && (
                  <div className="py-2">
                    <EqualizerLoader size="sm" label={LABEL[phase]} />
                  </div>
                )}
              </div>

              {notice && (
                <div className="mt-2 rounded-[4px] border border-amber-900/60 bg-amber-950/40 p-2 text-xs text-amber-200">
                  {notice}
                </div>
              )}

              {error && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[4px] border border-red-900/60 bg-red-950/50 p-2 text-xs text-red-200">
                  <span className="flex-1">{error}</span>
                  {hasPendingAudio && phase === 'idle' && (
                    <Button variant="default" className="text-xs" onClick={retryAudio}>
                      Retry audio
                    </Button>
                  )}
                  {canRetry && (
                    <Button variant="default" className="text-xs" onClick={phase === 'failed' ? startSession : () => sendTurn('')}>
                      {modelBlocked ? 'Change model' : 'Retry'}
                    </Button>
                  )}
                </div>
              )}

              {/* Text answer input */}
              <div className="mt-2.5 flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Type your technical answer (press Enter to send)…"
                  value={text}
                  disabled={!canType}
                  onChange={(e) => {
                    activityRef.current = Date.now();
                    setText(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && submitText()}
                />
                <Button
                  variant="default"
                  onClick={submitText}
                  disabled={!canType || !text.trim()}
                  className="shrink-0"
                >
                  Send
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column (7 Cols on large): Code Editor & Live HUD */}
        <div className="space-y-3 lg:col-span-7 flex flex-col">
          {/* Top HUD: Countdown clock, waveform visualizer, and primary speaker button */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Clock elapsedRef={elapsedRef} isRunning={isRunning} totalSec={cfg.durationMin * 60} />
            <div className="flex flex-col justify-between rounded-[6px] border border-[#16231a] bg-[#0a0f0c] p-2.5">
              <Visualizer levelRef={levelRef} mode={vizMode} />
              <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-neutral-400">
                <span>MIC: {micOk ? (phase === 'listening' || phase === 'hearing' ? 'ON' : 'OFF') : 'MUTED'}</span>
                <span className="font-sans text-neutral-200 truncate ml-2 font-medium">{LABEL[phase]}</span>
              </div>
            </div>
          </div>

          {wrap && (
            <div className="rounded-[4px] border border-amber-900/60 bg-amber-950/40 p-2 text-xs text-amber-300">
              The interviewer is concluding the discussion and wrapping up.
            </div>
          )}

          {/* Quick Audio Action Bar */}
          <div className="grid grid-cols-4 gap-2">
            <Button
              variant="primary"
              className="col-span-2 py-2 text-xs font-semibold shadow-md"
              onClick={primary.onClick}
              disabled={primary.disabled}
            >
              {primary.label}
            </Button>
            <Button
              variant="default"
              className="text-xs"
              onClick={repeat}
              disabled={BUSY.includes(phase) || !lastSay.current}
            >
              Repeat
            </Button>
            {phase === 'paused' ? (
              <Button variant="default" className="text-xs" onClick={resume}>
                Resume
              </Button>
            ) : (
              <Button variant="default" className="text-xs" onClick={pause} disabled={BUSY.includes(phase)}>
                Pause
              </Button>
            )}
          </div>

          {/* Code Editor Pane (Expanded and spacious) */}
          <Card
            title="Solution Code Editor"
            right={
              <div className="flex items-center gap-3 text-xs">
                <select
                  className="rounded-[4px] border border-[#1c2d22] bg-[#070b08] px-2 py-0.5 font-mono text-xs text-neutral-200"
                  value={editor.lang}
                  onChange={(e) => setEditor((s) => ({ ...s, lang: e.target.value }))}
                >
                  {LANGS.map((l) => (
                    <option key={l.id} value={l.id} className="bg-[#070b08]">
                      {l.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-neutral-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editor.highlightOn}
                    onChange={(e) => setEditor((s) => ({ ...s, highlightOn: e.target.checked }))}
                    className="accent-emerald-500"
                  />
                  <span>Colors</span>
                </label>
              </div>
            }
          >
            <Suspense fallback={<div className="h-64 rounded-[6px] border border-[#1b2b20] bg-[#070b08]" />}>
              <CodeEditor
                value={code}
                onChange={onCodeChange}
                lang={editor.lang}
                highlightOn={editor.highlightOn}
              />
            </Suspense>
            <div className="mt-2.5 flex items-center justify-between">
              <p className="text-[11px] text-neutral-400 font-mono">
                Tab indents. Shift+Tab outdents.
              </p>
              <Button
                variant="primary"
                onClick={submitCode}
                disabled={!canType || !code.trim()}
                className="text-xs shadow-md"
              >
                Submit code to interviewer
              </Button>
            </div>
          </Card>

          {/* Audio Settings Collapsible */}
          <details className="rounded-lg border border-[#16231a] bg-[#0a0f0c] p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-neutral-300 hover:text-white">
              Audio & Speech Settings
            </summary>
            <div className="mt-3 space-y-3 border-t border-[#16231a] pt-3">
              <Field
                label={`Silence tolerance: ${(settings.silenceMs / 1000).toFixed(1)}s`}
                hint="How long you can pause mid-sentence before answer finishes."
              >
                <input
                  type="range"
                  min="2000"
                  max="8000"
                  step="250"
                  value={settings.silenceMs}
                  onChange={(e) => set('silenceMs', Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </Field>

              <label className="flex items-start gap-2 text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-emerald-500"
                  checked={settings.autoMic}
                  onChange={(e) => set('autoMic', e.target.checked)}
                />
                <span className="leading-tight">
                  Auto-arm microphone after question reading delay (off by default)
                </span>
              </label>

              {settings.autoMic && (
                <Field label={`Reading delay: ${settings.readSec}s`}>
                  <input
                    type="range"
                    min="3"
                    max="60"
                    step="1"
                    value={settings.readSec}
                    onChange={(e) => set('readSec', Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </Field>
              )}

              <Field label={`Speech rate: ${settings.rate.toFixed(1)}x`}>
                <input
                  type="range"
                  min="0.8"
                  max="1.4"
                  step="0.1"
                  value={settings.rate}
                  onChange={(e) => set('rate', Number(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </Field>

              <Field label="Interviewer voice">
                <select
                  className={inputCls}
                  value={settings.voiceURI}
                  onChange={(e) => set('voiceURI', e.target.value)}
                >
                  <option value="">
                    Auto ({interviewerInfo?.name ? `${interviewerInfo.name} · ${interviewerInfo.gender}` : 'matches persona'})
                  </option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </details>
        </div>
      </div>

      {/* In-app Confirmation Dialog for Ending Interview (no browser alert) */}
      <ConfirmModal
        open={showEndConfirm}
        title="Finish Interview Session?"
        description="Are you ready to conclude your interview? The AI evaluator will immediately evaluate your answers, problem-solving, code correctness, and communication to generate your final report."
        confirmText="End and evaluate"
        cancelText="Continue interview"
        variant="primary"
        onConfirm={() => {
          setShowEndConfirm(false);
          doEnd();
        }}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
}
