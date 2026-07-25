import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Reveal, Spinner, EmptyState, Modal, Card, useToast } from '../components/ui.jsx';

export default function Notifications({ navigate, refreshUnread }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [emailOpen, setEmailOpen] = useState(null);

  const load = () => {
    api('/api/notifications')
      .then((d) => setItems(d.notifications))
      .catch((e) => toast(e.message, 'error'));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = async (n) => {
    if (n.read) return;
    try {
      await api(`/api/notifications/${n.id}/read`, { method: 'POST' });
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      refreshUnread();
    } catch { /* non-critical */ }
  };

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow">Messages in a bottle</span>
        <h1 className="hero-title">Notifications</h1>
      </Reveal>
      <div className="section-gap">
        {!items ? (
          <div className="center"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState emoji="🫧">Nothing here yet. If support ever rebuilds a lesson for you, it lands here first.</EmptyState>
        ) : (
          items.map((n, i) => (
            <Reveal key={n.id} delay={i * 70}>
              <div className={`notif-row ${n.read ? '' : 'unread'}`}>
                <div style={{ flex: 1 }}>
                  <b>{n.title}</b>
                  <p>{n.body}</p>
                  <div className="ctrl-row" style={{ marginTop: '0.7rem' }}>
                    {n.sessionId && (
                      <button className="btn btn--primary" onClick={() => { markRead(n); navigate(`/session/${n.sessionId}`); }}>
                        Open the new lesson <span className="btn-orb">→</span>
                      </button>
                    )}
                    {n.emailHtml && (
                      <button className="btn btn--ghost" onClick={() => { markRead(n); setEmailOpen(n); }}>
                        View the email we sent 📧
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>
          ))
        )}
      </div>

      {emailOpen && (
        <Modal onClose={() => setEmailOpen(null)}>
          <Card>
            <div className="row-between" style={{ marginBottom: '0.8rem' }}>
              <b>Email preview — as delivered to your inbox</b>
              <button className="btn btn--ghost" onClick={() => setEmailOpen(null)}>Close ✕</button>
            </div>
            <iframe className="email-frame" title="Email preview" srcDoc={emailOpen.emailHtml} sandbox="" />
          </Card>
        </Modal>
      )}
    </div>
  );
}
