import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, fmtDate, fmtTime } from './ui.jsx';

function Stat({ label, value, sub }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </Card>
  );
}

function Trend({ points }) {
  if (points.length < 2) return <p className="text-sm text-neutral-500">Complete at least two interviews to see a trend.</p>;
  const w = 320, h = 90, pad = 8;
  const xy = points.map((p, i) => [pad + (i * (w - 2 * pad)) / (points.length - 1), h - pad - (p.score / 10) * (h - 2 * pad)]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {[5, 7].map((g) => <line key={g} x1={pad} x2={w - pad} y1={h - pad - (g / 10) * (h - 2 * pad)} y2={h - pad - (g / 10) * (h - 2 * pad)} stroke="#262626" strokeDasharray="3 3" />)}
      <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="#34d399" strokeWidth="2" />
      {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill="#34d399"><title>{points[i].score}</title></circle>)}
    </svg>
  );
}

const TopicList = ({ items, empty }) => items.length === 0
  ? <p className="text-sm text-neutral-500">{empty}</p>
  : <ul className="space-y-1.5 text-sm">{items.map((t) => (
    <li key={`${t.mode}${t.topic}`} className="flex justify-between"><span>{t.topic} <span className="text-xs text-neutral-500">({t.mode})</span></span><span className="tabular-nums text-neutral-400">{t.avg.toFixed(1)} · {t.attempts}x</span></li>
  ))}</ul>;

export default function Dashboard({ meta, onStart, onOpen }) {
  const [stats, setStats] = useState(null);
  const [list, setList] = useState([]);
  const [usage, setUsage] = useState(null);
  const [err, setErr] = useState('');

  const load = () => Promise.all([api.stats(), api.interviews(), api.usage()])
    .then(([s, l, u]) => { setStats(s); setList(l.interviews); setUsage(u); })
    .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <p className="text-red-300">{err}</p>;
  if (!stats) return <p className="text-neutral-500">Loading…</p>;
  const modeLabel = (id) => meta.modes.find((m) => m.id === id)?.label ?? id;
  const companyName = (id) => meta.companies.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Button variant="primary" onClick={onStart}>Start interview</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Evaluated interviews" value={stats.reports} />
        <Stat label="Average score" value={stats.avgScore == null ? '–' : `${stats.avgScore}/10`} />
        <Stat label="Solved without hints" value={stats.solvedWithoutHints} />
        <Stat label="Needed hints" value={stats.neededHints} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Recent progress"><Trend points={stats.trend} /></Card>
        <Card title="Weak topics"><TopicList items={stats.weakTopics} empty="No weak topics recorded yet." /></Card>
        <Card title="Strong topics"><TopicList items={stats.strongTopics} empty="No strong topics yet. Scores of 7+ show up here." /></Card>
      </div>

      {stats.recentWeaknesses.length > 0 && (
        <Card title="Recurring weaknesses from recent reports">
          <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">{stats.recentWeaknesses.map((w) => <li key={w}>{w}</li>)}</ul>
        </Card>
      )}

      <Card title="Previous interviews">
        {list.length === 0 ? <p className="text-sm text-neutral-500">No interviews yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-neutral-500"><tr><th className="pb-2">Date</th><th>Mode</th><th>Company</th><th>Style</th><th>Time</th><th>Score</th><th /></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="border-t border-neutral-800">
                    <td className="py-2 pr-3">{fmtDate(i.started_at)}</td>
                    <td>{modeLabel(i.mode)}</td>
                    <td>{companyName(i.company)} <span className="text-xs text-neutral-500">{i.difficulty}</span></td>
                    <td className="capitalize">{i.personality}</td>
                    <td className="tabular-nums">{fmtTime(i.elapsed_sec)}</td>
                    <td className="tabular-nums">{i.overall_score != null ? i.overall_score.toFixed(1) : <span className="text-neutral-500">{i.status}</span>}</td>
                    <td className="space-x-1 text-right">
                      <Button variant="ghost" onClick={() => onOpen(i.id)}>Open</Button>
                      <Button variant="ghost" onClick={async () => { if (window.confirm('Delete this interview?')) { await api.remove(i.id); load(); } }}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {usage && (
        <p className="text-xs text-neutral-500">
          Since the server started today: {Math.round(usage.sttSeconds)}s of audio transcribed ({usage.sttBudgetUsedPct}% of the {usage.sttDailyBudgetSec}s/day budget), {usage.llmRequests} LLM requests.
          {Object.entries(usage.limits).map(([k, v]) => ` ${k}: ${v.remainingRequests ?? '?'} requests / ${v.remainingTokens ?? '?'} tokens left.`)}
        </p>
      )}
    </div>
  );
}
