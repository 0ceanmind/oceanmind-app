import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { useHashRoute } from './router.js';
import { ToastProvider, Icon, Spinner } from './components/ui.jsx';
import SignIn from './views/SignIn.jsx';
import Home from './views/Home.jsx';
import SessionView from './views/SessionView.jsx';
import Sessions from './views/Sessions.jsx';
import Projects from './views/Projects.jsx';
import Notifications from './views/Notifications.jsx';
import Admin from './views/Admin.jsx';
import AdminLibrary from './views/AdminLibrary.jsx';
import { SupportInbox, ReportDetail } from './views/Support.jsx';

function Shell() {
  const { parts, navigate } = useHashRoute();
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [unread, setUnread] = useState(0);
  const [ai, setAi] = useState({ configured: false, provider: null });

  const refreshAi = useCallback(() => {
    api('/api/ai/status').then(setAi).catch(() => {});
  }, []);

  useEffect(() => {
    api('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
    refreshAi();
  }, [refreshAi]);

  const refreshUnread = useCallback(() => {
    api('/api/notifications')
      .then((d) => setUnread(d.notifications.filter((n) => !n.read).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const t = setInterval(refreshUnread, 20000);
    return () => clearInterval(t);
  }, [user, refreshUnread]);

  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/');
  };

  const route = parts[0] ?? '';
  const isSupport = route === 'support';
  const isAdmin = route === 'admin';

  if (user === undefined) {
    return <div className="page center" style={{ paddingTop: '40vh' }}><Spinner /></div>;
  }

  return (
    <>
      <nav className="nav" aria-label="Main">
        <button className="nav-brand" onClick={() => navigate(isSupport ? '/support' : '/')}>
          <Icon.wave size={20} /> OceanMind{isSupport ? ' · Support' : isAdmin ? ' · Admin' : ''}
        </button>
        {user && !isSupport && !isAdmin && (
          <>
            <button className={`nav-link ${route === '' ? 'active' : ''}`} onClick={() => navigate('/')}>Dive</button>
            <button className={`nav-link ${route === 'sessions' ? 'active' : ''}`} onClick={() => navigate('/sessions')}>Logbook</button>
            <button className={`nav-link ${route === 'projects' ? 'active' : ''}`} onClick={() => navigate('/projects')}>Projects</button>
            <button className="nav-bell" onClick={() => navigate('/notifications')} aria-label={`Notifications${unread ? ` — ${unread} unread` : ''}`}>
              <Icon.bell />
              {unread > 0 && <span className="dot" />}
            </button>
            <button className="nav-link" onClick={() => navigate('/admin')} title={ai.configured ? `Model: ${ai.provider} · ${ai.model}` : 'No model connected'}>
              ⚙{!ai.configured && <span style={{ color: 'var(--coral)' }}> !</span>}
            </button>
            <span className="nav-user">{user.name}</span>
            <button className="nav-link" onClick={signOut}>Sign out</button>
          </>
        )}
        {(isSupport || isAdmin) && (
          <button className="nav-link" onClick={() => navigate('/')}>← Learner view</button>
        )}
      </nav>

      {isAdmin ? (
        parts[1] === 'library'
          ? <AdminLibrary navigate={navigate} />
          : <Admin navigate={navigate} onConfigChanged={refreshAi} />
      ) : isSupport ? (
        parts[1] === 'report' && parts[2] ? (
          <ReportDetail reportId={parts[2]} navigate={navigate} />
        ) : (
          <SupportInbox navigate={navigate} />
        )
      ) : !user ? (
        <SignIn onSignedIn={(u) => { setUser(u); navigate('/'); }} />
      ) : route === 'session' && parts[1] ? (
        <SessionView sessionId={parts[1]} navigate={navigate} />
      ) : route === 'sessions' ? (
        <Sessions navigate={navigate} />
      ) : route === 'projects' ? (
        <Projects navigate={navigate} />
      ) : route === 'notifications' ? (
        <Notifications navigate={navigate} refreshUnread={refreshUnread} />
      ) : (
        <Home user={user} navigate={navigate} aiConfigured={ai.configured} />
      )}
    </>
  );
}

/** Last line of defense: no white screens, ever. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[oceanmind] render error:', error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page page--narrow center" style={{ paddingTop: '22vh' }}>
        <span style={{ fontSize: '2.4rem' }}>🌊</span>
        <h1 className="hero-title" style={{ fontSize: '1.9rem' }}>Rough waters — something broke on screen.</h1>
        <p className="lede" style={{ margin: '0.8rem auto 0' }}>
          Your progress is saved on the server. Resurface and everything will be where you left it.
        </p>
        <p className="muted mt-1">{String(this.state.error?.message ?? this.state.error).slice(0, 200)}</p>
        <button className="btn btn--primary mt-3" onClick={() => { this.setState({ error: null }); window.location.hash = '#/'; window.location.reload(); }}>
          Resurface <span className="btn-orb">→</span>
        </button>
      </div>
    );
  }
}

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </ToastProvider>
  );
}
