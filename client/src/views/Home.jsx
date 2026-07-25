import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Reveal, Icon, Spinner, useToast } from '../components/ui.jsx';

export default function Home({ user, navigate, aiConfigured }) {
  const toast = useToast();
  const [topics, setTopics] = useState(null);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [noMatch, setNoMatch] = useState(false);

  useEffect(() => {
    api('/api/topics')
      .then((d) => setTopics(d.topics))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const start = async (topicId, title) => {
    setBusy(true);
    setBusyLabel(`The agent is reading the source material and compiling your ${title} experience…`);
    try {
      const { session } = await api('/api/sessions', { method: 'POST', body: { topicId } });
      navigate(`/session/${session.id}`);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
      setBusyLabel('');
    }
  };

  const submitAsk = async (e) => {
    e.preventDefault();
    if (!ask.trim() || busy) return;
    setNoMatch(false);
    setBusy(true);
    setBusyLabel('Understanding what you want to learn…');
    try {
      const { match } = await api('/api/topics/match', { method: 'POST', body: { text: ask } });
      if (match) {
        toast(`That maps to “${match.title}” — compiling your experience.`, 'success');
        await start(match.id, match.title);
        return;
      }
      setNoMatch(true);
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
    setBusyLabel('');
  };

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow"><Icon.wave size={13} /> Welcome back, {user.name}</span>
        <h1 className="hero-title">What do you want<br />to <em>learn about AI?</em></h1>
        <p className="lede">
          Tell the agent in your own words. It reads the source material, maps the
          knowledge, measures your depth, and builds a lesson that exists only for you.
        </p>
      </Reveal>

      <Reveal delay={120}>
        <form className="ask-row" onSubmit={submitAsk}>
          <input
            className="ask-input"
            value={ask}
            onChange={(e) => { setAsk(e.target.value); setNoMatch(false); }}
            placeholder="e.g. “I want to understand how neural networks learn”"
            maxLength={300}
            disabled={busy}
            aria-label="What do you want to learn about AI?"
            autoFocus
          />
          <button className="btn btn--primary" type="submit" disabled={busy || !ask.trim()}>
            {busy ? <Spinner /> : 'Dive in'}
            {!busy && <span className="btn-orb">→</span>}
          </button>
        </form>

        {/* suggested topics — plain suggestions under the input, not cards */}
        {topics && !busy && (
          <div className="suggest-row" aria-label="Suggested topics">
            <span className="suggest-label">Suggested:</span>
            {topics.map((t) => (
              <button key={t.id} className="suggest-pill" onClick={() => start(t.id, t.title)} title={t.tagline}>
                {t.title}
              </button>
            ))}
          </div>
        )}

        {noMatch && (
          <p className="form-error" role="alert" style={{ marginTop: '0.8rem' }}>
            The agent couldn’t map that to one of today’s dives — this MVP currently covers the
            suggested topics above. Try one of them, or different words.
          </p>
        )}

        {busy && (
          <div className="compiling" role="status">
            <Spinner />
            <div>
              <b>{busyLabel}</b>
              <p className="muted">Reading sources · compiling the knowledge map · writing your placement questions — usually 10–30 seconds.</p>
            </div>
          </div>
        )}

        {!aiConfigured && (
          <p className="form-error" style={{ marginTop: '1rem' }}>
            No AI model is connected yet, so dives can’t start. <button className="linklike" onClick={() => navigate('/admin')}>Connect one in Admin →</button>
          </p>
        )}
      </Reveal>
    </div>
  );
}
