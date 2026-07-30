import { useState } from 'react';
import { apiFetch } from '../api';

export function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch('/auth', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        setError('Incorrect password');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate__card">
        <div className="gate__mark">K</div>
        <div className="gate__eyebrow">
          <span className="dot" />
          kimi-connect
        </div>
        <h1 className="gate__title">Welcome back</h1>
        <p className="gate__subtitle">Enter the access password to continue.</p>
        <form onSubmit={handleSubmit}>
          <div className="gate__field">
            <label className="gate__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="gate__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoFocus
              disabled={submitting}
            />
          </div>
          <button className="gate__submit" type="submit" disabled={submitting}>
            {submitting ? 'Checking…' : 'Enter'}
          </button>
          {error && <p className="gate__error" role="alert">{error}</p>}
        </form>
      </div>
    </div>
  );
}
