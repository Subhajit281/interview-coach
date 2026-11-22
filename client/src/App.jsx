import { useEffect, useState } from 'react';
import { api, modelPrefs } from './lib/api.js';
import { BACKEND_WAKE_TIMEOUT_MS, sleep, waitForBackend } from './lib/connection.js';
import Dashboard from './components/Dashboard.jsx';
import Configure from './components/Configure.jsx';
import Interview from './components/Interview.jsx';
import Report from './components/Report.jsx';
import Auth from './components/Auth.jsx';
import ApiKeys from './components/ApiKeys.jsx';
import { ModelGateProvider, ModelSettings } from './components/ModelPicker.jsx';
import { EqualizerLoader, ConfirmModal } from './components/ui.jsx';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState({ name: 'dashboard' });
  const [user, setUser] = useState(null);
  const [credentials, setCredentials] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [boot, setBoot] = useState({ state: 'loading', elapsedMs: 0, attempt: 0 });

  // In-app confirmation dialog states (no native browser alerts)
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [settingsTab, setSettingsTab] = useState('keys');

  // A first request wakes Render. Auth starts only after that request succeeds so an
  // expired refresh call cannot make a cold server look like a logged-out user.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const started = Date.now();
    setAuthChecking(true);
    setBoot((b) => ({ state: 'loading', elapsedMs: 0, attempt: b.attempt }));
    const progress = setInterval(() => {
      if (active) setBoot((b) => ({ ...b, elapsedMs: Date.now() - started }));
    }, 1000);
    (async () => {
      try {
        const waking = await waitForBackend(api.health, {
          signal: controller.signal,
          onAttempt: () => active && setBoot((b) => ({ ...b, elapsedMs: Date.now() - started })),
        });
        if (!active) return;
        if (!waking.ok) {
          setBoot({ state: 'failed', elapsedMs: waking.elapsedMs, attempt: boot.attempt });
          setAuthChecking(false);
          return;
        }
        // Keep the transition polished, but never add more than the documented 15 s.
        await sleep(Math.max(0, 15_000 - (Date.now() - started)), controller.signal);
        await api.refresh().then(() => api.me()).then((r) => {
          if (!active) return;
          setUser(r.user);
          setCredentials(r.credentials);
          if (r.credentials?.geminiConfigured || r.credentials?.groqConfigured) {
            api.meta().then((m) => { if (active) setMeta(m); }).catch((e) => { if (active) setErr(e.message); });
          }
        }).catch(() => {});
        if (active) { setBoot((b) => ({ ...b, state: 'ready' })); setAuthChecking(false); }
      } catch {
        // Unmount/Retry aborts are intentional and should not flash an error screen.
      } finally { clearInterval(progress); }
    })();
    return () => {
      active = false;
      controller.abort();
      clearInterval(progress);
    };
  }, [boot.attempt]);

  // Fetch or refresh meta when credentials change
  useEffect(() => {
    if (user && credentials && (credentials.geminiConfigured || credentials.groqConfigured) && !meta) {
      api.meta().then(setMeta).catch((e) => setErr(e.message));
    }
  }, [user, credentials, meta]);

  // Model choices are remembered per account on this browser.
  modelPrefs.setOwner(user?.id || user?.email);

  const active = view.name === 'interview';
  const leave = (next) => {
    if (active) {
      setLeaveTarget(next);
      return;
    }
    setView(next);
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    await api.logout();
    setUser(null);
    setCredentials(null);
    setMeta(null);
  };

  if (boot.state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050806] p-6 text-center">
        <div className="max-w-md space-y-5">
          <EqualizerLoader size="lg" label="Waking up the secure interview server…" />
          <div className="space-y-1.5">
            <h1 className="text-base font-semibold text-neutral-100">Preparing Interview Coach</h1>
            <p className="text-sm leading-relaxed text-neutral-400">The server may take around 30 seconds to wake up. We’re getting everything ready for you. Please wait…</p>
            <p className="font-mono text-xs text-emerald-400">{Math.min(Math.floor(boot.elapsedMs / 1000), Math.floor(BACKEND_WAKE_TIMEOUT_MS / 1000))}s elapsed</p>
          </div>
        </div>
      </div>
    );
  }

  if (boot.state === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050806] p-6 text-center">
        <div className="max-w-md rounded-lg border border-red-900/60 bg-red-950/30 p-6 space-y-4">
          <h1 className="text-base font-semibold text-neutral-100">Server is still waking up</h1>
          <p className="text-sm leading-relaxed text-neutral-300">We could not reach the interview server after about 50 seconds. This is usually temporary on a free Render service.</p>
          <button className="rounded-[6px] bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500" onClick={() => setBoot((b) => ({ ...b, state: 'loading', attempt: b.attempt + 1 }))}>Retry connection</button>
        </div>
      </div>
    );
  }

  if (authChecking) return null;

  // Unauthenticated: show modern Auth view
  if (!user) {
    return (
      <div className="min-h-screen bg-[#050806] flex flex-col justify-center">
        <Auth
          onAuthenticated={(next) => {
            setUser(next);
            api.me().then((r) => {
              setCredentials(r.credentials);
              if (r.credentials?.geminiConfigured || r.credentials?.groqConfigured) {
                api.meta().then(setMeta).catch((e) => setErr(e.message));
              }
            });
          }}
        />
      </div>
    );
  }

  // First-time onboarding: prompt to configure API keys
  if (!credentials || credentials.credentialResetRequired || (!credentials.geminiConfigured && !credentials.groqConfigured)) {
    return (
      <div className="min-h-screen bg-[#050806] p-4 flex flex-col justify-center">
        <div className="mx-auto max-w-xl w-full mb-3 text-center">
          <div className="inline-block rounded-[6px] border border-emerald-800/40 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
            {credentials?.credentialResetRequired ? 'Your saved AI key needs to be restored.' : `Welcome, ${user.name || user.email}! Set up your AI keys to begin.`}
          </div>
        </div>
        <ApiKeys
          status={credentials || {}}
          onSaved={(newCreds) => {
            setCredentials(newCreds);
            api.meta().then(setMeta).catch((e) => setErr(e.message));
          }}
        />
      </div>
    );
  }

  return (
    <ModelGateProvider>
    <div className="min-h-screen bg-[#050806] text-neutral-200">
      {/* Sleek top navigation */}
      <header className="sticky top-0 z-50 border-b border-[#16231a] bg-[#070c09]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
          {/* Brand text (clean, no logo) */}
          <button
            className="text-sm font-semibold tracking-wide text-neutral-100 hover:text-white transition-colors"
            onClick={() => leave({ name: 'dashboard' })}
          >
            Interview Coach
          </button>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1.5">
            <button
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-all ${
                view.name === 'dashboard'
                  ? 'border border-[#1c2d22] bg-[#0e1711] text-emerald-300 shadow-sm'
                  : 'text-neutral-400 hover:bg-[#0c140f] hover:text-neutral-200'
              }`}
              onClick={() => leave({ name: 'dashboard' })}
            >
              Dashboard
            </button>
            <button
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-all ${
                view.name === 'configure' || view.name === 'interview'
                  ? 'border border-[#1c2d22] bg-[#0e1711] text-emerald-300 shadow-sm'
                  : 'text-neutral-400 hover:bg-[#0c140f] hover:text-neutral-200'
              }`}
              onClick={() => leave({ name: 'configure' })}
            >
              New interview
            </button>
            <button
              className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-all ${
                view.name === 'keys'
                  ? 'border border-[#1c2d22] bg-[#0e1711] text-emerald-300 shadow-sm'
                  : 'text-neutral-400 hover:bg-[#0c140f] hover:text-neutral-200'
              }`}
              onClick={() => leave({ name: 'keys' })}
            >
              Settings
            </button>

            <span className="mx-1 h-3.5 w-[1px] bg-[#16231a]" />

            {/* User profile / logout with custom confirmation modal */}
            <div className="flex items-center gap-2 pl-1">
              <span className="hidden md:inline-block text-[11px] font-mono text-neutral-400 truncate max-w-[140px]">
                {user.email}
              </span>
              <button
                className="rounded-[6px] border border-transparent px-2.5 py-1 text-xs text-neutral-400 hover:border-[#1c2d22] hover:bg-[#0f1711] hover:text-neutral-200 transition-all"
                onClick={() => setShowLogoutConfirm(true)}
              >
                Log out
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* Main container */}
      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        {err && (
          <div className="mb-4 rounded-[6px] border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-200">
            The server could not complete that request: {err}. Please retry; on a first production visit it may still be waking up.
          </div>
        )}

        {meta && view.name === 'dashboard' && (
          <Dashboard
            meta={meta}
            onStart={() => setView({ name: 'configure' })}
            onOpen={(id) => setView({ name: 'report', id })}
          />
        )}

        {meta && view.name === 'configure' && (
          <Configure
            meta={meta}
            onCancel={() => setView({ name: 'dashboard' })}
            onStart={(cfg) => setView({ name: 'interview', cfg, key: Date.now() })}
          />
        )}

        {meta && view.name === 'interview' && (
          <Interview
            key={view.key}
            cfg={view.cfg}
            meta={meta}
            onExit={() => setView({ name: 'configure' })}
            onFinished={(r) => setView({ name: 'report', id: r.interviewId, note: r.note })}
          />
        )}

        {meta && view.name === 'report' && (
          <Report
            id={view.id}
            note={view.note}
            onBack={() => setView({ name: 'dashboard' })}
            onNew={() => setView({ name: 'configure' })}
          />
        )}

        {view.name === 'keys' && (
          <div className="mx-auto flex max-w-4xl flex-col gap-4 md:flex-row md:items-start">
            {/* Settings tabs: left panel on desktop, a row on small screens */}
            <nav className="flex shrink-0 gap-1.5 md:sticky md:top-20 md:w-44 md:flex-col" aria-label="Settings sections">
              {[['keys', 'Manage API keys'], ['models', 'AI models']].map(([id, label]) => (
                <button
                  key={id}
                  className={`rounded-[6px] px-3 py-2 text-left text-xs font-medium transition-all ${
                    settingsTab === id
                      ? 'border border-[#1c2d22] bg-[#0e1711] text-emerald-300 shadow-sm'
                      : 'border border-transparent text-neutral-400 hover:bg-[#0c140f] hover:text-neutral-200'
                  }`}
                  onClick={() => setSettingsTab(id)}
                  aria-current={settingsTab === id ? 'page' : undefined}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="min-w-0 flex-1 [&>div]:mx-0">
              {settingsTab === 'keys' ? (
                <ApiKeys
                  settings
                  status={credentials}
                  onSaved={(newCreds) => {
                    setCredentials(newCreds);
                    api.meta().then(setMeta).catch((e) => setErr(e.message));
                  }}
                />
              ) : (
                <div className="max-w-xl">
                  <ModelSettings credentials={credentials} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* In-app Confirmation Modals (no browser alerts) */}
      <ConfirmModal
        open={Boolean(leaveTarget)}
        title="Leave Active Interview?"
        description="Are you sure you want to leave the active interview session? An unfinished interview will not be evaluated."
        confirmText="Leave interview"
        cancelText="Stay in session"
        variant="danger"
        onConfirm={() => {
          const next = leaveTarget;
          setLeaveTarget(null);
          setView(next);
        }}
        onCancel={() => setLeaveTarget(null)}
      />

      <ConfirmModal
        open={showLogoutConfirm}
        title="Log Out"
        description="Are you sure you want to log out of your Interview Coach account?"
        confirmText="Log out"
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
    </ModelGateProvider>
  );
}
