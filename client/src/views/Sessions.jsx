import { useEffect, useState } from 'react';
import { api, parseTs } from '../api.js';
import { Reveal, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const STATUS_LABEL = {
  assessment: { text: 'Depth check in progress', cls: 'new' },
  lesson: { text: 'Lesson in progress', cls: 'new' },
  awaiting_rebuild: { text: 'With support', cls: 'new' },
  closed: { text: 'Complete', cls: 'resolved' },
};

export default function Sessions({ navigate }) {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    api('/api/sessions')
      .then((d) => setSessions(d.sessions))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow">Your logbook</span>
        <h1 className="hero-title">Past dives</h1>
      </Reveal>
      <div className="section-gap">
        {!sessions ? (
          <div className="center"><Spinner /></div>
        ) : sessions.length === 0 ? (
          <EmptyState emoji="🐚">
            No dives yet — pick a topic and take your first depth check.
            <br />
            <button className="btn btn--primary mt-2" onClick={() => navigate('/')}>Choose a topic →</button>
          </EmptyState>
        ) : (
          sessions.map((s, i) => {
            const st = STATUS_LABEL[s.status] ?? { text: s.status, cls: 'resolved' };
            return (
              <Reveal key={s.id} delay={i * 70}>
                <button className="report-row" onClick={() => navigate(`/session/${s.id}`)}>
                  <span>
                    <span className="who">{s.topicTitle}{s.version > 1 ? ` · rebuilt v${s.version}` : ''}</span>
                    <span className="what">
                      {s.zone ? `${s.depth.toLocaleString()} m · ` : ''}started {parseTs(s.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className={`status-pill ${st.cls}`}>{st.text}</span>
                </button>
              </Reveal>
            );
          })
        )}
      </div>
    </div>
  );
}
