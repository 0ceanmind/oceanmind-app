import { useState } from 'react';
import { api } from '../api.js';
import { Card, Reveal, Icon, Spinner } from '../components/ui.jsx';
import { sleep } from '../lib/motion.js';

export default function SignIn({ onSignedIn }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { user } = await api('/api/auth/session', { method: 'POST', body: { name, email } });
      setLeaving(true); // glide out before Home takes over
      await sleep(300);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className={`page page--narrow${leaving ? ' om-v-leave' : ''}`}>
      <Reveal>
        <div className="center" style={{ marginBottom: '2.4rem' }}>
          <span className="eyebrow"><Icon.wave size={13} /> Depth-based AI learning</span>
          <h1 className="hero-title">Dive into AI,<br /><em>at your depth.</em></h1>
          <p className="lede" style={{ margin: '0 auto' }}>
            OceanMind measures what you already know, then builds an interactive
            lesson at exactly your depth — from sunlit shallows to the midnight zone.
          </p>
        </div>
      </Reveal>
      <Reveal delay={150}>
        <Card>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="si-name">Your name</label>
              <input id="si-name" className="input" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Faisal" maxLength={80} autoFocus data-demo="signin-name" />
            </div>
            <div className="field">
              <label htmlFor="si-email">Email</label>
              <input id="si-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" data-demo="signin-email" />
              <p className="muted mt-1">Used to recognize you and deliver rebuilt lessons — no password needed.</p>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn--primary mt-1" type="submit" disabled={busy || !name.trim() || !email.trim()} data-demo="signin-submit">
              {busy ? 'Diving in…' : 'Start diving'}
              <span className="btn-orb">{busy ? <Spinner /> : '→'}</span>
            </button>
          </form>
        </Card>
      </Reveal>
    </div>
  );
}
