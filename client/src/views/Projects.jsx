import { useEffect, useState } from 'react';
import { api, parseTs } from '../api.js';
import { Reveal, Spinner, EmptyState, Modal, ModalClose, Card, useToast } from '../components/ui.jsx';

const KIND_ICON = { flow: '🔧', summary: '🪙' };
const isDiveLog = (p) => p.kind === 'summary' && Array.isArray(p.data?.learned);

export default function Projects({ navigate }) {
  const toast = useToast();
  const [projects, setProjects] = useState(null);
  const [preview, setPreview] = useState(null);
  const [opening, setOpening] = useState(null); // id being fetched for the preview
  const [removing, setRemoving] = useState(null); // id sliding out

  const load = () => api('/api/projects').then((d) => setProjects(d.projects)).catch((e) => toast(e.message, 'error'));
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (p) => {
    setOpening(p.id);
    try {
      const { project } = await api(`/api/projects/${p.id}`);
      setPreview(project);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setOpening(null);
    }
  };

  const download = async (p) => {
    try {
      const { project } = await api(`/api/projects/${p.id}`);
      const blob = new Blob([JSON.stringify(project.data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name.replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('Downloaded 📦', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (p) => {
    try {
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      setRemoving(p.id); // slide the row out, then drop it
      setTimeout(() => {
        setProjects((list) => list.filter((x) => x.id !== p.id));
        setRemoving(null);
      }, 300);
      toast('Project deleted.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow">🗂️ Your workshop</span>
        <h1 className="hero-title">Projects</h1>
        <p className="lede">Everything you build in OceanMind — agent flows, saved dive logs — lives here. Open, download, or remove any of them.</p>
      </Reveal>
      <div className="section-gap">
        {!projects ? (
          <div className="center"><Spinner /></div>
        ) : projects.length === 0 ? (
          <EmptyState emoji="🐚">
            Nothing built yet. Inside an AI Agents lesson, build a flow and hit <b>Save to Projects</b> — or finish any dive to store its log here.
            <br /><button className="btn btn--primary mt-2" onClick={() => navigate('/')}>Start a dive →</button>
          </EmptyState>
        ) : (
          projects.map((p, i) => (
            <Reveal key={p.id} delay={i * 60}>
              <div className={`report-row${removing === p.id ? ' om-v-removing' : ''}`} style={{ cursor: 'default' }}
                data-demo="project-row" data-project-id={p.id} data-kind={p.kind}>
                <span>
                  <span className="who">{KIND_ICON[p.kind] ?? '📦'} {p.name}</span>
                  <span className="what">
                    {p.kind === 'flow' ? 'Agent flow' : 'Dive log'}{p.topicTitle ? ` · ${p.topicTitle}` : ''} · updated {parseTs(p.updatedAt).toLocaleDateString()}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="btn btn--ghost" onClick={() => open(p)} disabled={opening === p.id}
                    data-demo="project-open" data-project-id={p.id}>
                    {opening === p.id ? <Spinner /> : 'Open'}
                  </button>
                  <button className="btn btn--ghost" onClick={() => download(p)}>⬇</button>
                  <button className="icon-btn" onClick={() => remove(p)} aria-label="Delete">✕</button>
                </span>
              </div>
            </Reveal>
          ))
        )}
      </div>

      {preview && (
        <Modal onClose={() => setPreview(null)}>
          <Card>
            <div className="row-between" style={{ marginBottom: '0.8rem' }}>
              <b>{KIND_ICON[preview.kind] ?? '📦'} {preview.name}</b>
              <ModalClose />
            </div>
            {preview.kind === 'flow' ? (
              <p className="muted" style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                {preview.data?.nodes?.length ?? 0} steps, {preview.data?.edges?.length ?? 0} connections.
                {preview.sessionId && ' Reopen the lesson to keep building it.'}
              </p>
            ) : null}
            {isDiveLog(preview) ? (
              // a saved dive log reads as the log it is, not as JSON
              <div className="om-v-logpreview">
                {preview.data.headline && <p className="lede" style={{ fontSize: '1rem', color: '#fff' }}>{preview.data.headline}</p>}
                <div className="log-cols om-v-log">
                  {[
                    { cls: 'learned', title: '🌊 What you learned', items: preview.data.learned },
                    { cls: 'built', title: '🔧 What you built', items: preview.data.built },
                    { cls: 'next', title: '🧭 Where to dive next', items: preview.data.nextSteps },
                  ].map((c, ci) => (
                    <div key={c.cls} className={`log-col ${c.cls}`} style={{ '--c': ci }}>
                      <h4>{c.title}</h4>
                      <ul>{(c.items ?? []).map((x, xi) => <li key={xi} style={{ '--i': xi }}>{x}</li>)}</ul>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <pre style={{ maxHeight: 340, overflow: 'auto', background: 'rgba(5,18,30,0.7)', border: '1px solid var(--hairline)', borderRadius: '0.7rem', padding: '0.9rem', fontSize: '0.74rem', color: 'var(--ink-dim)', marginTop: '0.8rem', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(preview.data, null, 2).slice(0, 4000)}
              </pre>
            )}
          </Card>
        </Modal>
      )}
    </div>
  );
}
