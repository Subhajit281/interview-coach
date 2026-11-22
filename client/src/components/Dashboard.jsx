import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, Skeleton, Badge, ConfirmModal, fmtDate, fmtTime } from './ui.jsx';

// In-memory client cache to make returning to Dashboard instant (0ms delay)
let dashboardCache = null;

function Stat({ label, value, sub, highlight = false }) {
  return (
    <Card className="relative overflow-hidden">
      {highlight && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-600/60" />
      )}
      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/70">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-neutral-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-neutral-400">{sub}</div>}
    </Card>
  );
}

function Trend({ points }) {
  if (!points || points.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-neutral-400">
        Complete at least two interviews to see your performance trend curve.
      </div>
    );
  }
  const w = 320, h = 90, pad = 12;
  const xy = points.map((p, i) => [
    pad + (i * (w - 2 * pad)) / (points.length - 1),
    h - pad - (Math.max(0, Math.min(10, p.score)) / 10) * (h - 2 * pad),
  ]);
  const polyPoints = xy.map((p) => p.join(',')).join(' ');
  const areaPoints = `${xy[0][0]},${h - pad} ${polyPoints} ${xy[xy.length - 1][0]},${h - pad}`;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full overflow-visible">
        <defs>
          <linearGradient id="emeraldGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        {[5, 7].map((g) => {
          const y = h - pad - (g / 10) * (h - 2 * pad);
          return (
            <g key={g}>
              <line x1={pad} x2={w - pad} y1={y} y2={y} stroke="#1b2a20" strokeDasharray="3 3" />
              <text x={w - pad + 3} y={y + 3} fill="#4b5e52" fontSize="8" fontFamily="monospace">{g}</text>
            </g>
          );
        })}
        <polygon points={areaPoints} fill="url(#emeraldGlow)" />
        <polyline points={polyPoints} fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {xy.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="3.5"
            fill="#10b981"
            stroke="#070b08"
            strokeWidth="1.5"
            className="transition-all hover:r-5 cursor-pointer"
          >
            <title>{`Interview #${i + 1}: ${points[i].score}/10`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400 font-mono">
        <span>Earliest</span>
        <span className="text-emerald-400/80">Latest ({points[points.length - 1].score}/10)</span>
      </div>
    </div>
  );
}

const TopicList = ({ items, empty, isWeak = false }) =>
  !items || items.length === 0 ? (
    <p className="text-xs text-neutral-400 leading-relaxed py-2">{empty}</p>
  ) : (
    <ul className="space-y-2 text-xs">
      {items.map((t) => (
        <li
          key={`${t.mode}${t.topic}`}
          className="flex items-center justify-between rounded-[4px] border border-[#16231a] bg-[#070b08] px-2.5 py-1.5 transition-colors hover:border-[#223628]"
        >
          <span className="font-medium text-neutral-200 truncate pr-2">
            {t.topic}{' '}
            <span className="text-[10px] uppercase font-mono text-neutral-400">({t.mode})</span>
          </span>
          <span className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
            <span
              className={`rounded-[3px] px-1.5 py-0.5 text-[11px] font-semibold ${
                isWeak
                  ? 'bg-rose-950/60 text-rose-300 border border-rose-900/50'
                  : 'bg-emerald-950/60 text-emerald-300 border border-emerald-900/50'
              }`}
            >
              {t.avg.toFixed(1)}
            </span>
            <span className="text-[10px] text-neutral-400">{t.attempts}x</span>
          </span>
        </li>
      ))}
    </ul>
  );

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded-lg border border-[#16231a] bg-[#0a0f0c] p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-[#16231a] bg-[#0a0f0c] p-4 space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[#16231a] bg-[#0a0f0c] p-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

export default function Dashboard({ meta, onStart, onOpen }) {
  const [stats, setStats] = useState(() => dashboardCache?.stats || null);
  const [list, setList] = useState(() => dashboardCache?.list || []);
  const [usage, setUsage] = useState(() => dashboardCache?.usage || null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(() => !dashboardCache);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    try {
      const [s, l, u] = await Promise.all([api.stats(), api.interviews(), api.usage()]);
      dashboardCache = { stats: s, list: l.interviews, usage: u };
      setStats(s);
      setList(l.interviews);
      setUsage(u);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.remove(deleteTarget.id);
      dashboardCache = null; // Invalidate cache so recalculation is fresh
      await load();
      setDeleteTarget(null);
    } catch (e) {
      setErr(`Delete failed: ${e.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (err && !stats) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">
        <p className="font-medium">Failed to load dashboard data</p>
        <p className="mt-1 text-xs text-red-300/80">{err}</p>
        <Button variant="default" className="mt-3" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading && !stats) {
    return <DashboardSkeleton />;
  }

  const modeLabel = (id) => meta?.modes?.find((m) => m.id === id)?.label ?? id;
  const companyName = (id) => meta?.companies?.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      {/* Top action header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-[#16231a] pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Interview Dashboard
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">Overview of your preparation progress, strengths, and interview history.</p>
        </div>
        <Button variant="primary" onClick={onStart} className="self-start sm:self-auto shadow-md">
          Start interview
        </Button>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Evaluated sessions"
          value={stats.reports}
          sub={`${list.length} total recorded`}
          highlight
        />
        <Stat
          label="Average score"
          value={stats.avgScore == null ? '–' : `${stats.avgScore.toFixed(1)}/10`}
          sub={stats.avgScore >= 7 ? 'Strong performance' : stats.avgScore >= 5 ? 'Progressing well' : 'Needs practice'}
          highlight
        />
        <Stat
          label="Solved without hints"
          value={stats.solvedWithoutHints}
          sub="Autonomous solutions"
        />
        <Stat
          label="Needed hints"
          value={stats.neededHints}
          sub="Guided prompts used"
        />
      </div>

      {/* Analytics Grid: Trend & Topics */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Score progression">
          <Trend points={stats.trend} />
        </Card>
        <Card title="Focus areas (Weak topics)">
          <TopicList items={stats.weakTopics} empty="No weak topics recorded yet." isWeak />
        </Card>
        <Card title="Mastered topics (Strong topics)">
          <TopicList items={stats.strongTopics} empty="No strong topics recorded yet. Scores of 7.0+ will appear here." />
        </Card>
      </div>

      {/* Recurring weaknesses */}
      {stats.recentWeaknesses && stats.recentWeaknesses.length > 0 && (
        <Card title="Key recurring feedback from recent interviews">
          <ul className="space-y-1.5 pl-2 text-xs text-neutral-300">
            {stats.recentWeaknesses.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-neutral-500">•</span>
                <span className="leading-relaxed">{w}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Previous interviews table */}
      <Card
        title="Previous interview sessions"
        right={
          list.length > 0 && (
            <span className="text-xs font-mono text-neutral-400">
              {list.length} {list.length === 1 ? 'record' : 'records'}
            </span>
          )
        }
      >
        {list.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-neutral-300">No interviews recorded yet</p>
            <p className="mt-1 text-xs text-neutral-400">Launch your first mock session to evaluate your coding and communication.</p>
            <Button variant="primary" className="mt-3" onClick={onStart}>
              Start first interview
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#16231a] bg-[#070b08] text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3">Company & Round</th>
                  <th className="py-2.5 px-3">Style</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Score</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#16231a]/60 font-sans">
                {list.map((i) => {
                  const hasScore = i.overall_score != null;
                  const scoreVal = hasScore ? i.overall_score : null;
                  return (
                    <tr
                      key={i.id}
                      className="transition-colors hover:bg-[#0e1611]/80 group"
                    >
                      <td className="py-2.5 px-3 font-mono text-neutral-300 whitespace-nowrap">
                        {fmtDate(i.started_at)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant="emerald">{modeLabel(i.mode)}</Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-medium text-neutral-200">{companyName(i.company)}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-neutral-400">[{i.difficulty}]</span>
                      </td>
                      <td className="py-2.5 px-3 capitalize text-neutral-300">{i.personality}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-neutral-300">
                        {fmtTime(i.elapsed_sec)}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums">
                        {hasScore ? (
                          <span
                            className={`inline-block font-semibold ${
                              scoreVal >= 7
                                ? 'text-emerald-400'
                                : scoreVal >= 5
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {scoreVal.toFixed(1)} / 10
                          </span>
                        ) : (
                          <span className="capitalize text-neutral-400 italic">{i.status}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1 whitespace-nowrap">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs hover:text-emerald-300"
                          onClick={() => onOpen(i.id)}
                        >
                          View Report
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-neutral-400 hover:text-red-300 hover:bg-red-950/30"
                          onClick={() => setDeleteTarget(i)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Usage summary without dot */}
      {usage && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#16231a] bg-[#070b08] px-3.5 py-2 text-[11px] text-neutral-400">
          <div>
            Session Speech: <strong className="font-mono text-neutral-300">{Math.round(usage.sttSeconds)}s</strong> transcribed ({usage.sttBudgetUsedPct}% of {usage.sttDailyBudgetSec}s daily quota) · LLM calls: <strong className="font-mono text-neutral-300">{usage.llmRequests}</strong>
          </div>
          <div className="font-mono text-[10px] text-neutral-400">
            {Object.entries(usage.limits || {}).map(([k, v]) => `${k}: ${v.remainingRequests ?? '?'} reqs left`).join(' · ')}
          </div>
        </div>
      )}

      {/* Custom in-app Confirmation Dialog for Deleting Interview (no browser alert) */}
      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Interview Session?"
        description={
          deleteTarget
            ? `Are you sure you want to permanently delete this ${modeLabel(deleteTarget.mode)} interview session from ${fmtDate(deleteTarget.started_at)}? All transcript, evaluations, and metrics will be completely removed from the database, and your progression trends and topic analytics will recalculate immediately.`
            : ''
        }
        confirmText={deleting ? 'Deleting…' : 'Delete Session'}
        cancelText="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
