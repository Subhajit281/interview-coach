import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, ScoreBar, fmtDate } from './ui.jsx';

const LABELS = {
  problem_understanding: 'Problem understanding', approach_selection: 'Approach selection', technical_knowledge: 'Technical knowledge',
  algorithmic_reasoning: 'Algorithmic reasoning', code_correctness: 'Code correctness', time_complexity: 'Time complexity',
  space_complexity: 'Space complexity', edge_case_handling: 'Edge-case handling', communication: 'Communication', confidence_clarity: 'Confidence and clarity',
};

const VERDICT_LABEL = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect', not_answered: 'Not answered' };
const VERDICT_STYLE = {
  correct: 'bg-emerald-950 text-emerald-300', partial: 'bg-amber-950 text-amber-300',
  incorrect: 'bg-red-950 text-red-300', not_answered: 'bg-neutral-800 text-neutral-400',
};

const List = ({ items }) => <ul className="list-disc space-y-1 pl-5 text-sm text-neutral-300">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export default function Report({ id, note, onBack, onNew }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.interview(id).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  const regenerate = async () => {
    setBusy(true); setErr('');
    try { await api.regenerateReport(id); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err && !data) return <p className="text-red-300">{err}</p>;
  if (!data) return <p className="text-neutral-500">Loading…</p>;
  const { interview: iv, messages, report: r } = data;
  // Older reports only have plain strings: show those when the detailed fields are absent.
  const strengthItems = r?.strength_evidence?.length ? r.strength_evidence : (r?.strengths ?? []).map((area) => ({ area, evidence: '' }));
  const weakItems = r?.weakness_analysis?.length ? r.weakness_analysis : (r?.weaknesses ?? []).map((area) => ({ area, evidence: '', impact: '', fix: '' }));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Interview report</h1>
          <p className="text-xs text-neutral-500">{fmtDate(iv.started_at)} · {iv.mode} · {iv.company} · {iv.difficulty} · {iv.personality}</p>
        </div>
        <div className="space-x-2"><Button onClick={onBack}>Dashboard</Button><Button variant="primary" onClick={onNew}>New interview</Button></div>
      </div>
      {err && <p className="rounded border border-red-900 bg-red-950/40 p-2 text-sm text-red-200">{err}</p>}

      {!r ? (
        <Card>
          <p className="text-sm text-neutral-300">{note || (iv.status === 'abandoned' ? 'This interview was too short to evaluate.' : 'No report has been generated for this interview.')}</p>
          {iv.status === 'completed' && <Button className="mt-3" onClick={regenerate} disabled={busy}>{busy ? 'Generating…' : 'Generate report'}</Button>}
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-end gap-6">
              <div><div className="text-xs uppercase text-neutral-500">Overall</div><div className="text-4xl font-semibold tabular-nums">{r.overall_score.toFixed(1)}<span className="text-lg text-neutral-500">/10</span></div></div>
              <div><div className="text-xs uppercase text-neutral-500">Recommendation</div><div className="text-lg">{r.hire_recommendation}</div></div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-neutral-200">{r.final_assessment}</p>
            {r.signal_notes && <p className="mt-3 text-sm text-neutral-400"><span className="text-neutral-300">Correctness vs. interview-level signal: </span>{r.signal_notes}</p>}
          </Card>

          <Card title="Category scores">
            <div className="grid gap-4 sm:grid-cols-2">{Object.entries(LABELS).map(([k, l]) => <ScoreBar key={k} label={l} value={r.categories[k]} />)}</div>
          </Card>

          {(r.readiness || r.communication_feedback) && (
            <div className="grid gap-4 md:grid-cols-2">
              {r.readiness && <Card title="Readiness for this kind of interview"><p className="text-sm leading-relaxed text-neutral-300">{r.readiness}</p></Card>}
              {r.communication_feedback && <Card title="Communication"><p className="text-sm leading-relaxed text-neutral-300">{r.communication_feedback}</p></Card>}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Strengths">
              {strengthItems.length === 0 ? <p className="text-sm text-neutral-500">None identified.</p> : (
                <ul className="space-y-3 text-sm">
                  {strengthItems.map((x, i) => (
                    <li key={i}><div className="font-medium text-emerald-300/90">{x.area}</div>{x.evidence && <div className="text-neutral-400">{x.evidence}</div>}</li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Weak areas and how to fix them">
              {weakItems.length === 0 ? <p className="text-sm text-neutral-500">None identified.</p> : (
                <ul className="space-y-3 text-sm">
                  {weakItems.map((x, i) => (
                    <li key={i}>
                      <div className="font-medium text-amber-300/90">{x.area}</div>
                      {x.evidence && <div className="text-neutral-400">Seen: {x.evidence}</div>}
                      {x.impact && <div className="text-neutral-400">Impact: {x.impact}</div>}
                      {x.fix && <div className="text-neutral-200">Fix: {x.fix}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Question by question: your answer vs the ideal answer">
            {r.question_breakdown?.length ? (
              <div className="space-y-3">
                {r.question_breakdown.map((q, i) => (
                  <details key={i} className="rounded border border-neutral-800 p-3 text-sm" open={q.verdict !== 'correct'}>
                    <summary className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="font-medium">{i + 1}. {q.title}{q.topic && <span className="ml-2 text-xs text-neutral-500">{q.topic}</span>}</span>
                      <span className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-xs ${VERDICT_STYLE[q.verdict]}`}>{VERDICT_LABEL[q.verdict]}</span>
                        <span className="tabular-nums text-neutral-400">{q.score.toFixed(1)}/10</span>
                      </span>
                    </summary>
                    <div className="mt-3 space-y-2">
                      <div><div className="text-xs uppercase text-neutral-500">Your answer</div><p className="whitespace-pre-wrap text-neutral-300">{q.your_answer}</p></div>
                      <div><div className="text-xs uppercase text-emerald-500/80">Ideal answer</div><p className="whitespace-pre-wrap text-neutral-200">{q.ideal_answer}</p></div>
                      {q.what_was_missing && <div><div className="text-xs uppercase text-red-400/80">What was missing or wrong</div><p className="whitespace-pre-wrap text-neutral-300">{q.what_was_missing}</p></div>}
                      {q.optimization && <div><div className="text-xs uppercase text-sky-400/80">Optimisation and improvement</div><p className="whitespace-pre-wrap text-neutral-300">{q.optimization}</p></div>}
                      {q.followup_handling && <div><div className="text-xs uppercase text-neutral-500">Counter-questions</div><p className="text-neutral-400">{q.followup_handling}</p></div>}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                {r.breakdown_missing ? 'The per-question breakdown could not be generated this time. ' : 'This report was created before the detailed breakdown existed. '}
                {iv.status === 'completed' && <Button className="ml-2" onClick={regenerate} disabled={busy}>{busy ? 'Generating…' : 'Regenerate detailed report'}</Button>}
              </p>
            )}
          </Card>

          {r.improvement_plan?.length > 0 && (
            <Card title="Improvement plan">
              <ol className="space-y-3 text-sm">
                {r.improvement_plan.map((x, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs">{i + 1}</span>
                    <span><span className="text-neutral-100">{x.action}</span>{x.timeframe && <span className="ml-2 text-xs text-emerald-400/80">{x.timeframe}</span>}{x.why && <span className="block text-neutral-400">{x.why}</span>}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {r.topic_scores?.length > 0 && (
            <Card title="Topic scores">
              <div className="grid gap-4 sm:grid-cols-2">{r.topic_scores.map((t) => <ScoreBar key={t.topic} label={`${t.topic}${t.hints_used ? ` (${t.hints_used} hint${t.hints_used > 1 ? 's' : ''})` : ''}`} value={t.score} />)}</div>
            </Card>
          )}

          <Card title="Mistakes made">
            {r.mistakes.length === 0 ? <p className="text-sm text-neutral-500">No specific mistakes recorded.</p> : (
              <div className="space-y-3 text-sm">
                {r.mistakes.map((m, i) => (
                  <div key={i} className="rounded border border-neutral-800 p-3">
                    <div className="font-medium">{m.what}</div>
                    <div className="mt-1 text-neutral-400">Why it is wrong: {m.why_wrong}</div>
                    <div className="mt-1 text-emerald-300/90">Better: {m.correct}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Recommended topics"><List items={r.recommended_topics} /></Card>
            <Card title="Suggested practice problems">
              <ul className="space-y-1 text-sm text-neutral-300">{r.practice_problems.map((p, i) => <li key={i}>{p.title} <span className="text-xs text-neutral-500">{p.platform} · {p.topic}</span></li>)}</ul>
              <p className="mt-2 text-xs text-neutral-500">Verify titles on the platform before relying on them.</p>
            </Card>
          </div>
          <p className="text-xs text-neutral-600">Evaluated by {r.evaluated_by}. Scores come from an AI model reading the transcript and can be noisy; look at trends across interviews.</p>
        </>
      )}

      <details className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <summary className="cursor-pointer text-sm text-neutral-300">Transcript ({messages.length} messages)</summary>
        <div className="mt-3 space-y-2 text-sm">
          {messages.map((m) => (
            <div key={m.id}><span className="text-xs uppercase text-neutral-500">{m.role === 'candidate' ? 'You' : 'Interviewer'}: </span><span className="whitespace-pre-wrap text-neutral-300">{m.content}</span>
              {m.board && <pre className="mt-1 whitespace-pre-wrap rounded bg-neutral-950 p-2 text-xs text-neutral-400">{m.board}</pre>}</div>
          ))}
        </div>
      </details>
    </div>
  );
}
