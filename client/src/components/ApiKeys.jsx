import { useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, Field, inputCls } from './ui.jsx';

export default function ApiKeys({ status = {}, onSaved, settings = false }) {
  const [geminiKey, setGemini] = useState('');
  const [groqKey, setGroq] = useState('');
  const [currentPassword, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const r = await api.saveCredentials({
        ...(geminiKey ? { geminiKey } : {}),
        ...(groqKey ? { groqKey } : {}),
        ...(settings ? { currentPassword } : {}),
      });
      setGemini('');
      setGroq('');
      setPassword('');
      setMessage('Keys validated and encrypted successfully.');
      onSaved(r);
    } catch (x) {
      setMessage(x.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (provider) => {
    const password = window.prompt(`Enter your password to remove the ${provider} key:`);
    if (!password) return;
    try {
      onSaved(await api.removeCredential(provider, password));
    } catch (x) {
      setMessage(x.message);
    }
  };

  const isGeminiOk = Boolean(status?.geminiConfigured);
  const isGroqOk = Boolean(status?.groqConfigured);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card title={settings ? 'Manage API keys' : 'Connect your AI providers'}>
        <p className="text-sm text-neutral-400 leading-relaxed mb-4">
          Provide your API keys to power the interview simulation. Keys are validated against the provider and encrypted using AES-256-GCM on the server.
        </p>

        {/* Current status without green/amber dots */}
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-[6px] border border-[#16231a] bg-[#070b08] p-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-400">Gemini:</span>
            <span className={isGeminiOk ? 'font-semibold text-emerald-400' : 'font-semibold text-amber-400'}>
              {isGeminiOk ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <span className="text-[#1c2d22]">|</span>
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-400">Groq:</span>
            <span className={isGroqOk ? 'font-semibold text-emerald-400' : 'font-semibold text-amber-400'}>
              {isGroqOk ? 'Configured' : 'Not configured'}
            </span>
          </div>
        </div>

        <form className="space-y-4" onSubmit={save}>
          <Field
            label="Gemini API key"
            hint={
              <span className="text-xs text-neutral-400">
                Get your Gemini key at{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sky-400 hover:text-sky-300 underline"
                >
                  aistudio.google.com/apikey
                </a>
              </span>
            }
          >
            <input
              className={inputCls}
              type={show ? 'text' : 'password'}
              placeholder={isGeminiOk ? '•••••••••••••••••••••••• (leave blank to keep)' : 'AIzaSy…'}
              value={geminiKey}
              onChange={(e) => setGemini(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field
            label="Groq API key"
            hint={
              <span className="text-xs text-neutral-400">
                Get your Groq key at{' '}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-sky-400 hover:text-sky-300 underline"
                >
                  console.groq.com/keys
                </a>
              </span>
            }
          >
            <input
              className={inputCls}
              type={show ? 'text' : 'password'}
              placeholder={isGroqOk ? '•••••••••••••••••••••••• (leave blank to keep)' : 'gsk_…'}
              value={groqKey}
              onChange={(e) => setGroq(e.target.value)}
              autoComplete="off"
            />
          </Field>

          {settings && (
            <Field label="Current password" hint="Required to authorize credential updates">
              <input
                className={inputCls}
                type="password"
                placeholder="Enter your account password"
                value={currentPassword}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          )}

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-neutral-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={show}
                onChange={(e) => setShow(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#1c2d22] bg-[#070b08] accent-emerald-500"
              />
              <span>Show keys</span>
            </label>
          </div>

          {message && (
            <div
              className={`rounded-[6px] border p-2.5 text-xs ${
                message.includes('successfully') || message.includes('saved')
                  ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                  : 'border-red-900/60 bg-red-950/40 text-red-300'
              }`}
            >
              {message}
            </div>
          )}

          <div className="pt-2">
            <Button
              variant="primary"
              disabled={busy || (!geminiKey && !groqKey)}
              className="w-full sm:w-auto"
            >
              {busy ? 'Validating credentials…' : 'Save and validate'}
            </Button>
          </div>
        </form>

        {settings && (
          <div className="mt-6 border-t border-[#16231a] pt-4">
            <div className="text-xs font-medium uppercase tracking-wider text-neutral-400 mb-2">Remove Credentials</div>
            <div className="flex flex-wrap gap-2">
              {isGeminiOk && (
                <Button variant="danger" onClick={() => remove('gemini')}>
                  Remove Gemini key
                </Button>
              )}
              {isGroqOk && (
                <Button variant="danger" onClick={() => remove('groq')}>
                  Remove Groq key
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
