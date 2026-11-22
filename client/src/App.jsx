import { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import Dashboard from './components/Dashboard.jsx';
import Configure from './components/Configure.jsx';
import Interview from './components/Interview.jsx';
import Report from './components/Report.jsx';
import Auth from './components/Auth.jsx';
import ApiKeys from './components/ApiKeys.jsx';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState({ name: 'dashboard' });
  const [user, setUser] = useState(null);
  const [credentials, setCredentials] = useState(null);

  useEffect(() => { api.refresh().then(() => api.me()).then((r) => { setUser(r.user); setCredentials(r.credentials); }).catch(() => {}); }, []);
  useEffect(() => { if (user && credentials && (credentials.geminiConfigured || credentials.groqConfigured)) api.meta().then(setMeta).catch((e) => setErr(e.message)); }, [user, credentials]);

  const active = view.name === 'interview';
  const leave = (next) => {
    if (active && !window.confirm('Leave the interview? It will not be evaluated.')) return;
    setView(next);
  };

  if (!user) return <Auth onAuthenticated={(next) => { setUser(next); api.me().then((r) => setCredentials(r.credentials)); }} />;
  if (!credentials || (!credentials.geminiConfigured && !credentials.groqConfigured)) return <div className="min-h-screen p-4"><ApiKeys status={credentials || {}} onSaved={setCredentials} /></div>;
  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <button className="text-sm font-semibold tracking-wide" onClick={() => leave({ name: 'dashboard' })}>Interview Coach</button>
          <nav className="space-x-4 text-sm text-neutral-400">
            <button className="hover:text-neutral-100" onClick={() => leave({ name: 'dashboard' })}>Dashboard</button>
            <button className="hover:text-neutral-100" onClick={() => leave({ name: 'configure' })}>New interview</button>
            <button className="hover:text-neutral-100" onClick={() => leave({ name: 'keys' })}>Settings</button>
            <button className="hover:text-neutral-100" onClick={async () => { await api.logout(); setUser(null); setCredentials(null); setMeta(null); }}>Log out</button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        {err && <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">Cannot reach the server: {err}. Start it with <code>npm run dev</code>.</p>}
        {meta && view.name === 'dashboard' && (
          <Dashboard meta={meta} onStart={() => setView({ name: 'configure' })} onOpen={(id) => setView({ name: 'report', id })} />
        )}
        {meta && view.name === 'configure' && (
          <Configure meta={meta} onCancel={() => setView({ name: 'dashboard' })} onStart={(cfg) => setView({ name: 'interview', cfg, key: Date.now() })} />
        )}
        {meta && view.name === 'interview' && (
          <Interview key={view.key} cfg={view.cfg} meta={meta}
            onExit={() => setView({ name: 'configure' })}
            onFinished={(r) => setView({ name: 'report', id: r.interviewId, note: r.note })} />
        )}
        {meta && view.name === 'report' && (
          <Report id={view.id} note={view.note} onBack={() => setView({ name: 'dashboard' })} onNew={() => setView({ name: 'configure' })} />
        )}
        {view.name === 'keys' && <ApiKeys settings status={credentials} onSaved={setCredentials} />}
      </main>
    </div>
  );
}
