import { useState } from 'react';
import { Button, Card, Field, inputCls } from './ui.jsx';
import { api } from '../lib/api.js';

export default function Auth({ onAuthenticated }) {
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (register) await api.register(form);
      const result = await api.login({ email: form.email, password: form.password });
      onAuthenticated(result.user);
    } catch (x) {
      setError(x.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      {/* Brand title without logo */}
      <div className="mb-6 text-center">
        <h1 className="text-xl font-bold tracking-tight text-white">Interview Coach</h1>
        <p className="mt-1 text-xs text-neutral-400">
          Technical interview preparation
        </p>
      </div>

      <Card>
        {/* Tab switch */}
        <div className="mb-5 grid grid-cols-2 rounded-[6px] border border-[#16231a] bg-[#070b08] p-1">
          <button
            type="button"
            className={`rounded-[4px] py-1.5 text-xs font-semibold transition-all ${
              !register
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
            onClick={() => { setRegister(false); setError(''); }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`rounded-[4px] py-1.5 text-xs font-semibold transition-all ${
              register
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
            onClick={() => { setRegister(true); setError(''); }}
          >
            Create account
          </button>
        </div>

        <form className="space-y-3.5" onSubmit={submit}>
          {register && (
            <Field label="Full name">
              <input
                className={inputCls}
                placeholder="Jane Doe"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
            </Field>
          )}

          <Field label="Email address">
            <input
              className={inputCls}
              type="email"
              placeholder="you@company.com"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              required
            />
          </Field>

          <Field
            label="Password"
            hint={register ? 'Must be at least 12 characters' : undefined}
          >
            <input
              className={inputCls}
              type="password"
              placeholder="••••••••••••"
              minLength={12}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              required
            />
          </Field>

          {register && (
            <Field label="Confirm password">
              <input
                className={inputCls}
                type="password"
                placeholder="••••••••••••"
                minLength={12}
                value={form.confirmPassword}
                onChange={(e) => set('confirmPassword', e.target.value)}
                required
              />
            </Field>
          )}

          {error && (
            <div className="rounded-[6px] border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="pt-2">
            <Button
              variant="primary"
              className="w-full justify-center py-2 text-sm shadow-md"
              disabled={busy}
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Please wait…</span>
                </span>
              ) : register ? (
                'Create account'
              ) : (
                'Sign in'
              )}
            </Button>
          </div>
        </form>

        <div className="mt-5 border-t border-[#16231a] pt-3 text-center">
          <p className="text-[11px] text-neutral-400">
            Encrypted session authentication
          </p>
        </div>
      </Card>
    </div>
  );
}
