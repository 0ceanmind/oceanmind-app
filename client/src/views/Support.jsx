import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Reveal, Spinner, EmptyState, useToast } from '../components/ui.jsx';

const FACE_EMOJI = { 1: '😞', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' };

export function SupportInbox({ navigate }) {
  const toast = useToast();
  const [reports, setReports] = useState(null);

  useEffect(() => {
    api('/api/support/reports')
      .then((d) => setReports(d.reports))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow">🛟 Support console</span>
        <h1 className="hero-title">Feedback inbox</h1>
        <p className="lede">
          Every unhappy rating lands here with the full session context. Investigate,
          recalibrate, and rebuild — the learner gets the new experience by email and in their account.
        </p>
      </Reveal>
      <div className="section-gap">
        {!reports ? (
          <div className="center"><Spinner /></div>
        ) : reports.length === 0 ? (
          <EmptyState emoji="🌅">All clear — no reports. Every diver is happy.</EmptyState>
        ) : (
          reports.map((r, i) => (
            <Reveal key={r.id} delay={i * 60}>
              <button className="report-row" onClick={() => navigate(`/support/report/${r.id}`)}>
                <span>
                  <span className="who">{FACE_EMOJI[r.rating]} {r.userName} · {r.topicTitle}</span>
                  <span className="what">
                    {r.reasons.length > 0 ? r.reasons.join(' · ') : 'No structured reason'}
                    {r.note ? ` — “${r.note.slice(0, 70)}${r.note.length > 70 ? '…' : ''}”` : ''}
                  </span>
                </span>
                <span className={`status-pill ${r.status}`}>{r.status}</span>
              </button>
            </Reveal>
          ))
        )}
      </div>
    </div>
  );
}

export function ReportDetail({ reportId, navigate }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [zone, setZone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/support/reports/${reportId}`)
      .then((d) => {
        setData(d);
        setZone(d.report.correctedZone ?? d.session.zone ?? 'sunlight');
      })
      .catch((e) => setError(e.message));
  }, [reportId]);

  if (error) {
    return (
      <div className="page page--narrow">
        <EmptyState emoji="🫧">{error}
          <br /><button className="btn btn--ghost mt-2" onClick={() => navigate('/support')}>← Back to inbox</button>
        </EmptyState>
      </div>
    );
  }
  if (!data) return <div className="page center"><Spinner /></div>;

  const { report, user, session, assessmentDetail, feedback, zones } = data;

  const resolve = async () => {
    setBusy(true);
    try {
      await api(`/api/support/reports/${report.id}/resolve`, { method: 'POST', body: { zone, note } });
      toast(`Rebuilt for ${user.name} at the ${zones[zone].label} — notification + email delivered.`, 'success');
      navigate('/support');
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="page page--narrow">
      <Reveal>
        <button className="btn btn--ghost" onClick={() => navigate('/support')}>← Inbox</button>
        <h1 className="hero-title" style={{ fontSize: '2rem', marginTop: '1.2rem' }}>
          Report #{report.id} · {session.topicTitle}
        </h1>
        <p className="lede">
          {user.name} ({user.email}) · dive v{session.version} · calibrated to{' '}
          {session.zone ? `${zones[session.zone].label} at ${session.depth?.toLocaleString()} m (scored ${session.score}%)` : '—'}
        </p>
      </Reveal>

      <Reveal delay={100}>
        <Card className="section-gap">
          <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>What the learner said</h3>
          <p style={{ fontSize: '1.6rem', marginBottom: '0.4rem' }}>{FACE_EMOJI[feedback.rating]} <span className="muted" style={{ fontSize: '0.9rem' }}>rating {feedback.rating}/5</span></p>
          {feedback.reasons.length > 0 && (
            <div className="reason-row" style={{ justifyContent: 'flex-start', marginBottom: '0.6rem' }}>
              {feedback.reasons.map((r) => <span key={r} className="reason-chip on">{r}</span>)}
            </div>
          )}
          {feedback.note ? <p className="lede" style={{ fontSize: '0.95rem' }}>“{feedback.note}”</p> : <p className="muted">No written note.</p>}
        </Card>
      </Reveal>

      <Reveal delay={160}>
        <Card className="section-gap">
          <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Depth check — answer by answer</h3>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Look for miscalibration: wrong answers or “no idea” on concepts the lesson then assumed — or lucky guesses that pushed the learner too deep.
          </p>
          {assessmentDetail.length === 0 ? (
            <p className="muted">No assessment on record (this was a rebuilt session).</p>
          ) : (
            assessmentDetail.map((d) => (
              <div key={d.questionId} className="answer-row">
                <div className="q">{d.text} <span className="muted">· {d.concept}</span></div>
                <div className="a">
                  {d.noIdea ? (
                    <>Answered: <b className="gap">“I don’t have any idea”</b></>
                  ) : d.isCorrect ? (
                    <>Answered: <b className="ok">{d.chosen}</b> ✓</>
                  ) : (
                    <>Answered: <b className="bad">{d.chosen}</b> ✗ — correct was: <b className="ok">{d.correctAnswer}</b></>
                  )}
                </div>
              </div>
            ))
          )}
        </Card>
      </Reveal>

      <Reveal delay={220}>
        <Card className="section-gap">
          {report.status === 'resolved' ? (
            <>
              <h3 style={{ fontSize: '1.05rem', marginBottom: '0.6rem' }}>Resolved ✓</h3>
              <p className="lede" style={{ fontSize: '0.95rem' }}>
                Rebuilt at the <b>{zones[report.correctedZone].label}</b>
                {report.supportNote ? <> with note: “{report.supportNote}”</> : null}. The learner was notified by email and in the platform.
              </p>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: '1.05rem', marginBottom: '0.8rem' }}>Rebuild the experience</h3>
              <div className="field">
                <label>Corrected depth zone</label>
                <div className="seg" role="group" aria-label="Corrected zone">
                  {Object.values(zones).map((z) => (
                    <button key={z.id} className={zone === z.id ? 'on' : ''} onClick={() => setZone(z.id)}>
                      {z.label}
                    </button>
                  ))}
                </div>
                {zone === session.zone && (
                  <p className="muted mt-1">Same zone as before — the learner gets a fresh run at the same depth. Change it if the calibration was the problem.</p>
                )}
              </div>
              <div className="field">
                <label>Note to the learner (goes into their email)</label>
                <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. “You clearly know more than your quiz score showed — we've moved you deeper.”" maxLength={1000} />
              </div>
              <button className="btn btn--primary" onClick={resolve} disabled={busy}>
                {busy ? <Spinner /> : 'Rebuild & deliver'}
                {!busy && <span className="btn-orb">→</span>}
              </button>
            </>
          )}
        </Card>
      </Reveal>
    </div>
  );
}
