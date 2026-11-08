export function Card({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-md border border-neutral-800 bg-neutral-900 ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
          <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ variant = 'default', className = '', ...p }) {
  const styles = {
    default: 'border-neutral-700 bg-neutral-800 hover:bg-neutral-700 text-neutral-100',
    primary: 'border-emerald-700 bg-emerald-700 hover:bg-emerald-600 text-white',
    danger: 'border-red-900 bg-red-950 hover:bg-red-900 text-red-200',
    ghost: 'border-transparent hover:bg-neutral-800 text-neutral-300',
  };
  return (
    <button
      {...p}
      className={`rounded border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    />
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500';

export function ScoreBar({ label, value }) {
  const na = value == null;
  const pct = na ? 0 : (value / 10) * 100;
  const color = na ? '' : value >= 7 ? 'bg-emerald-500' : value >= 5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="text-sm">
      <div className="mb-1 flex justify-between text-neutral-300">
        <span>{label}</span>
        <span className="tabular-nums text-neutral-400">{na ? 'n/a' : value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded bg-neutral-800">
        <div className={`h-1.5 rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export const fmtTime = (s) => `${String(Math.floor(Math.abs(s) / 60)).padStart(2, '0')}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
export const fmtDate = (d) => (d ? new Date(`${d}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
