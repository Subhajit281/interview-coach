export function Card({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-[#16231a] bg-[#0a0f0c] shadow-[0_1px_3px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.02)] ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between border-b border-[#16231a] bg-[#0d1510]/50 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-neutral-100">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ variant = 'default', className = '', ...p }) {
  const styles = {
    default: 'border-[#1c2d22] bg-[#0e1611] text-neutral-200 hover:bg-[#152219] hover:text-white hover:border-[#273d2f]',
    primary: 'border-emerald-500/40 bg-emerald-600 text-white font-medium hover:bg-emerald-500 active:bg-emerald-700 shadow-sm shadow-emerald-950/60',
    danger: 'border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/50 hover:text-red-200 hover:border-red-800/80',
    ghost: 'border-transparent text-neutral-300 hover:bg-[#121d15] hover:text-neutral-100',
    outline: 'border-emerald-700/60 bg-transparent text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300',
  };
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-sm font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant] || styles.default} ${className}`}
    />
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block text-sm">
      {label && <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-emerald-300/70">{label}</span>}
      {children}
      {hint && <span className="mt-1.5 block text-xs text-neutral-400 leading-normal">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-[6px] border border-[#1b2b20] bg-[#070b08] px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none transition-all duration-150';

export function ScoreBar({ label, value }) {
  const na = value == null;
  const pct = na ? 0 : Math.min(100, Math.max(0, (value / 10) * 100));
  const color = na ? 'bg-neutral-800' : value >= 7 ? 'bg-emerald-500' : value >= 5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="text-sm">
      <div className="mb-1.5 flex justify-between items-center text-neutral-300">
        <span className="font-medium text-xs text-neutral-300">{label}</span>
        <span className="font-mono text-xs tabular-nums text-neutral-400">{na ? 'n/a' : `${value.toFixed(1)} / 10`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#101a13] border border-[#18261d] overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton-shimmer rounded-[6px] ${className}`} />;
}

export function Badge({ children, variant = 'neutral', className = '' }) {
  const variants = {
    neutral: 'bg-[#101913] text-neutral-300 border-[#1c2c21]',
    emerald: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
    amber: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
    red: 'bg-red-950/60 text-red-300 border-red-800/60',
    blue: 'bg-sky-950/60 text-sky-300 border-sky-800/60',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-xs font-medium tracking-wide ${variants[variant] || variants.neutral} ${className}`}>
      {children}
    </span>
  );
}

/** Symmetrical 7-bar audio waveform equalizer animation in shades of green and black shine */
export function EqualizerLoader({ size = 'md', label = '', className = '' }) {
  const config = {
    sm: {
      gap: 'gap-[3px]',
      bars: [
        { h: 'h-3.5', w: 'w-[2.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-1' },
        { h: 'h-2.5', w: 'w-[2.5px]', color: 'bg-emerald-600', cls: 'waveform-bar-2' },
        { h: 'h-5', w: 'w-[2.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-3' },
        { h: 'h-7', w: 'w-[2.5px]', color: 'bg-emerald-300', cls: 'waveform-bar-4' },
        { h: 'h-5', w: 'w-[2.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-5' },
        { h: 'h-2.5', w: 'w-[2.5px]', color: 'bg-emerald-600', cls: 'waveform-bar-6' },
        { h: 'h-3.5', w: 'w-[2.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-7' },
      ],
    },
    md: {
      gap: 'gap-[4.5px]',
      bars: [
        { h: 'h-6', w: 'w-[3.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-1' },
        { h: 'h-4.5', w: 'w-[3.5px]', color: 'bg-emerald-600', cls: 'waveform-bar-2' },
        { h: 'h-8', w: 'w-[3.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-3' },
        { h: 'h-11', w: 'w-[3.5px]', color: 'bg-emerald-300', cls: 'waveform-bar-4' },
        { h: 'h-8', w: 'w-[3.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-5' },
        { h: 'h-4.5', w: 'w-[3.5px]', color: 'bg-emerald-600', cls: 'waveform-bar-6' },
        { h: 'h-6', w: 'w-[3.5px]', color: 'bg-emerald-400', cls: 'waveform-bar-7' },
      ],
    },
    lg: {
      gap: 'gap-[6px]',
      bars: [
        { h: 'h-9', w: 'w-[5px]', color: 'bg-emerald-400', cls: 'waveform-bar-1' },
        { h: 'h-7', w: 'w-[5px]', color: 'bg-emerald-600', cls: 'waveform-bar-2' },
        { h: 'h-12', w: 'w-[5px]', color: 'bg-emerald-400', cls: 'waveform-bar-3' },
        { h: 'h-16', w: 'w-[5px]', color: 'bg-emerald-300', cls: 'waveform-bar-4' },
        { h: 'h-12', w: 'w-[5px]', color: 'bg-emerald-400', cls: 'waveform-bar-5' },
        { h: 'h-7', w: 'w-[5px]', color: 'bg-emerald-600', cls: 'waveform-bar-6' },
        { h: 'h-9', w: 'w-[5px]', color: 'bg-emerald-400', cls: 'waveform-bar-7' },
      ],
    },
  }[size] || config.md;

  return (
    <div className={`flex flex-col items-center justify-center bg-transparent ${className}`}>
      <div className={`flex items-center justify-center ${config.gap}`}>
        {config.bars.map((b, i) => (
          <span
            key={i}
            className={`waveform-bar rounded-full ${b.w} ${b.h} ${b.color} ${b.cls}`}
          />
        ))}
      </div>
      {label && (
        <span className="mt-3 text-xs font-mono text-neutral-400 tracking-wide select-none">
          {label}
        </span>
      )}
    </div>
  );
}

/** Custom in-app Confirmation Dialog (no native browser alert) */
export function ConfirmModal({
  open,
  title = 'Confirm Action',
  description = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-lg border border-[#1e2e23] bg-[#090f0c] p-5 shadow-[0_12px_36px_rgba(0,0,0,0.85)] space-y-4">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-white">{title}</h3>
          <p className="mt-2 text-xs leading-relaxed text-neutral-300">{description}</p>
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#16231a]">
          <Button variant="default" onClick={onCancel} className="text-xs">
            {cancelText}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            className="text-xs font-semibold shadow-md"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const fmtTime = (s) => `${String(Math.floor(Math.abs(s) / 60)).padStart(2, '0')}:${String(Math.abs(s) % 60).padStart(2, '0')}`;

/**
 * Formats dates robustly across SQLite 'YYYY-MM-DD HH:mm:ss',
 * ISO-8601 strings, and Date objects without ever returning 'Invalid Date'.
 */
export const fmtDate = (d) => {
  if (!d) return '';
  try {
    let str = String(d).trim();
    // Handle SQL format "YYYY-MM-DD HH:mm:ss"
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}/.test(str)) {
      str = str.replace(' ', 'T') + 'Z';
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      str = `${str}T00:00:00Z`;
    } else if (!str.endsWith('Z') && !/[+-]\d{2}:\d{2}$/.test(str) && str.includes('T')) {
      str = `${str}Z`;
    }
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
    const directDate = new Date(d);
    if (!isNaN(directDate.getTime())) {
      return directDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }
    return '';
  } catch {
    return '';
  }
};
