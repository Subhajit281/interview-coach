import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, ScoreBar, Badge, EqualizerLoader, fmtDate } from './ui.jsx';

const LABELS = {
  problem_understanding: 'Problem understanding',
  approach_selection: 'Approach selection',
  technical_knowledge: 'Technical knowledge',
  algorithmic_reasoning: 'Algorithmic reasoning',
  code_correctness: 'Code correctness',
  time_complexity: 'Time complexity',
  space_complexity: 'Space complexity',
  edge_case_handling: 'Edge-case handling',
  communication: 'Communication',
  confidence_clarity: 'Confidence & clarity',
};

const VERDICT_LABEL = {
  correct: 'Correct',
  partial: 'Partly correct',
  incorrect: 'Incorrect',
  not_answered: 'Not answered',
};

const VERDICT_BADGE = {
  correct: 'emerald',
  partial: 'amber',
  incorrect: 'red',
  not_answered: 'neutral',
};

export default function Report({ id, note, onBack, onNew }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.interview(id).then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]);

  const regenerate = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.regenerateReport(id);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-200">
        <p className="font-semibold text-sm">Failed to load report</p>
        <p className="mt-1">{err}</p>
        <Button variant="default" className="mt-3" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-24 flex items-center justify-center">
        <EqualizerLoader size="lg" />
      </div>
    );
  }

  const { interview: iv, messages, report: r } = data;
  const strengthItems = r?.strength_evidence?.length
    ? r.strength_evidence
    : (r?.strengths ?? []).map((area) => ({ area, evidence: '' }));
  const weakItems = r?.weakness_analysis?.length
    ? r.weakness_analysis
    : (r?.weaknesses ?? []).map((area) => ({ area, evidence: '', impact: '', fix: '' }));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[#16231a] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-white">Interview Evaluation Report</h1>
            <Badge variant="emerald">Completed</Badge>
          </div>
          <p className="text-xs font-mono text-neutral-400 mt-0.5">
            {fmtDate(iv.started_at)} · {iv.mode.toUpperCase()} · {iv.company} · {iv.difficulty} · {iv.personality}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={onBack}>
            ← Dashboard
          </Button>
          <Button variant="primary" onClick={onNew}>
            New interview
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-200">
          {err}
        </div>
      )}

      {!r ? (
        <Card>
          <p className="text-xs text-neutral-300 leading-relaxed">
            {note || (iv.status === 'abandoned' ? 'This interview was too brief to produce an evaluation.' : 'No evaluation report is currently generated for this session.')}
          </p>
          {iv.status === 'completed' && (
            <Button className="mt-3" onClick={regenerate} disabled={busy}>
              {busy ? 'Evaluating session…' : 'Generate report'}
            </Button>
          )}
        </Card>
      ) : (
        <>
          {/* Executive Summary Card */}
          <Card className="relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-emerald-400 to-transparent" />
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#16231a] pb-4">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/70 block">
                  Overall Evaluation Score
                </span>
                <div className="mt-1 flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-bold tracking-tight text-white">
                    {r.overall_score.toFixed(1)}
                  </span>
                  <span className="text-sm font-semibold text-neutral-400">/ 10.0</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 block">
                  Hiring Recommendation
                </span>
                <div className="mt-1">
                  <Badge
                    variant={
                      r.overall_score >= 7.5
                        ? 'emerald'
                        : r.overall_score >= 5.5
                        ? 'amber'
                        : 'red'
                    }
                    className="text-xs font-semibold px-2.5 py-1"
                  >
                    {r.hire_recommendation}
                  </Badge>
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs sm:text-sm leading-relaxed text-neutral-200">
              {r.final_assessment}
            </p>

            {r.signal_notes && (
              <div className="mt-3 rounded-[6px] border border-[#16231a] bg-[#070b08] p-3 text-xs text-neutral-300">
                <span className="font-semibold text-emerald-400">Signal vs. Raw Correctness: </span>
                <span className="text-neutral-400">{r.signal_notes}</span>
              </div>
            )}
          </Card>

          {/* Category Scores */}
          <Card title="Competency & Category Breakdown">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(LABELS).map(([k, l]) => (
                <ScoreBar key={k} label={l} value={r.categories[k]} />
              ))}
            </div>
          </Card>

          {/* Readiness & Communication */}
          {(r.readiness || r.communication_feedback) && (
            <div className="grid gap-4 md:grid-cols-2">
              {r.readiness && (
                <Card title="Role Readiness Assessment">
                  <p className="text-xs sm:text-sm leading-relaxed text-neutral-300">
                    {r.readiness}
                  </p>
                </Card>
              )}
              {r.communication_feedback && (
                <Card title="Communication & Articulation Feedback">
                  <p className="text-xs sm:text-sm leading-relaxed text-neutral-300">
                    {r.communication_feedback}
                  </p>
                </Card>
              )}
            </div>
          )}

          {/* Strengths & Weaknesses */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Demonstrated Strengths">
              {strengthItems.length === 0 ? (
                <p className="text-xs text-neutral-400">No specific strengths recorded.</p>
              ) : (
                <ul className="space-y-3 text-xs">
                  {strengthItems.map((x, i) => (
                    <li key={i} className="rounded-[4px] border border-[#16231a] bg-[#070b08] p-2.5">
                      <div className="font-semibold text-emerald-300">{x.area}</div>
                      {x.evidence && <div className="mt-1 text-neutral-400 leading-normal">{x.evidence}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Growth Areas & Corrections">
              {weakItems.length === 0 ? (
                <p className="text-xs text-neutral-400">No specific weaknesses recorded.</p>
              ) : (
                <ul className="space-y-3 text-xs">
                  {weakItems.map((x, i) => (
                    <li key={i} className="rounded-[4px] border border-[#16231a] bg-[#070b08] p-2.5">
                      <div className="font-semibold text-amber-300">{x.area}</div>
                      {x.evidence && <div className="mt-1 text-neutral-400">Observed: {x.evidence}</div>}
                      {x.impact && <div className="mt-0.5 text-neutral-400">Impact: {x.impact}</div>}
                      {x.fix && <div className="mt-1 text-emerald-300/90 font-medium">Fix: {x.fix}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Question Breakdown */}
          <Card title="Question-by-Question Detailed Breakdown">
            {r.question_breakdown?.length ? (
              <div className="space-y-3">
                {r.question_breakdown.map((q, i) => (
                  <details
                    key={i}
                    className="rounded-[6px] border border-[#16231a] bg-[#070b08] p-3 text-xs"
                    open={q.verdict !== 'correct'}
                  >
                    <summary className="flex cursor-pointer items-center justify-between gap-3 font-medium select-none">
                      <span className="text-neutral-200">
                        {i + 1}. {q.title}
                        {q.topic && <span className="ml-2 font-mono text-[10px] text-neutral-400">[{q.topic}]</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        <Badge variant={VERDICT_BADGE[q.verdict] || 'neutral'}>
                          {VERDICT_LABEL[q.verdict] || q.verdict}
                        </Badge>
                        <span className="font-mono tabular-nums text-neutral-300 font-semibold">
                          {q.score.toFixed(1)}/10
                        </span>
                      </div>
                    </summary>

                    <div className="mt-3 space-y-2.5 border-t border-[#16231a] pt-3 text-xs">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 block">
                          Your response
                        </span>
                        <p className="mt-1 whitespace-pre-wrap text-neutral-300 leading-relaxed font-mono text-[11px] bg-[#0b100d] p-2 rounded">
                          {q.your_answer}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 block">
                          Ideal response
                        </span>
                        <p className="mt-1 whitespace-pre-wrap text-neutral-200 leading-relaxed font-mono text-[11px] bg-[#0c1610] p-2 rounded border border-emerald-900/40">
                          {q.ideal_answer}
                        </p>
                      </div>
                      {q.what_was_missing && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400 block">
                            Missing or incorrect nuances
                          </span>
                          <p className="mt-1 whitespace-pre-wrap text-neutral-300 leading-relaxed">
                            {q.what_was_missing}
                          </p>
                        </div>
                      )}
                      {q.optimization && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-400 block">
                            Complexity & optimization avenues
                          </span>
                          <p className="mt-1 whitespace-pre-wrap text-neutral-300 leading-relaxed">
                            {q.optimization}
                          </p>
                        </div>
                      )}
                      {q.followup_handling && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 block">
                            Follow-up questions handling
                          </span>
                          <p className="mt-1 text-neutral-400 leading-relaxed">
                            {q.followup_handling}
                          </p>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="text-xs text-neutral-400 py-2">
                Detailed per-question breakdown was not generated for this session.
                {iv.status === 'completed' && (
                  <Button className="ml-2 text-xs" onClick={regenerate} disabled={busy}>
                    {busy ? 'Evaluating…' : 'Regenerate breakdown'}
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Actionable Improvement Plan */}
          {r.improvement_plan?.length > 0 && (
            <Card title="Targeted Action Plan">
              <ol className="space-y-2.5 text-xs">
                {r.improvement_plan.map((x, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-[6px] border border-[#16231a] bg-[#070b08] p-3"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-950/80 border border-emerald-800/60 font-mono text-[11px] font-semibold text-emerald-300">
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold text-neutral-100">{x.action}</span>
                        {x.timeframe && (
                          <Badge variant="emerald" className="text-[10px]">
                            {x.timeframe}
                          </Badge>
                        )}
                      </div>
                      {x.why && <p className="mt-1 text-neutral-400 leading-normal">{x.why}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Topic Scores */}
          {r.topic_scores?.length > 0 && (
            <Card title="Topic Performance Breakdown">
              <div className="grid gap-3 sm:grid-cols-2">
                {r.topic_scores.map((t) => (
                  <ScoreBar
                    key={t.topic}
                    label={`${t.topic}${t.hints_used ? ` (${t.hints_used} hints)` : ''}`}
                    value={t.score}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* Mistakes made */}
          <Card title="Specific Technical Mistakes & Misconceptions">
            {r.mistakes.length === 0 ? (
              <p className="text-xs text-neutral-400">No major technical mistakes recorded.</p>
            ) : (
              <div className="space-y-2.5 text-xs">
                {r.mistakes.map((m, i) => (
                  <div key={i} className="rounded-[6px] border border-[#16231a] bg-[#070b08] p-3">
                    <div className="font-semibold text-rose-300">{m.what}</div>
                    <div className="mt-1 text-neutral-400">Why it is problematic: {m.why_wrong}</div>
                    <div className="mt-1 text-emerald-300 font-medium">Better approach: {m.correct}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Practice & Recommended Topics */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Recommended Study Topics">
              <ul className="space-y-1.5 text-xs text-neutral-300">
                {r.recommended_topics.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="text-neutral-500">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Curated Practice Problems">
              <ul className="space-y-1.5 text-xs text-neutral-300">
                {r.practice_problems.map((p, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span className="font-medium text-neutral-200">{p.title}</span>
                    <span className="font-mono text-[10px] text-neutral-400">
                      {p.platform} · {p.topic}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <p className="text-[11px] font-mono text-neutral-400 text-center pt-2">
            AI evaluation generated via {r.evaluated_by}. Review across multiple interviews for optimal trend accuracy.
          </p>
        </>
      )}

      {/* Full Transcript Collapsible */}
      <details className="rounded-lg border border-[#16231a] bg-[#0a0f0c] p-3 text-xs">
        <summary className="cursor-pointer font-semibold text-neutral-300 hover:text-white">
          Complete Session Transcript ({messages.length} exchanges)
        </summary>
        <div className="mt-3 space-y-2 border-t border-[#16231a] pt-3">
          {messages.map((m) => (
            <div key={m.id} className="rounded-[4px] border border-[#16231a] bg-[#070b08] p-2.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                {m.role === 'candidate' ? 'Candidate: ' : 'Interviewer: '}
              </span>
              <p className="mt-0.5 whitespace-pre-wrap text-neutral-200">{m.content}</p>
              {m.board && (
                <pre className="mt-1.5 overflow-x-auto rounded bg-[#0b100d] p-2 font-mono text-[11px] text-neutral-300 whitespace-pre-wrap">
                  {m.board}
                </pre>
              )}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
