import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Card, Reveal, Spinner, useToast } from '../components/ui.jsx';
import BlockRenderer from '../lessons/BlockRenderer.jsx';

const TOPIC_LABEL = {
  'neural-networks': 'Neural Networks',
  'ai-agents': 'AI Agents',
  chatbots: 'Chatbots',
  any: 'Authored by Lulu (any topic)',
};

export default function AdminLibrary({ navigate }) {
  const toast = useToast();
  const [blocks, setBlocks] = useState(null);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null); // block type currently previewed

  useEffect(() => {
    api('/api/admin/library')
      .then((d) => setBlocks(d.blocks))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const groups = useMemo(() => {
    if (!blocks) return [];
    const list = filter === 'all' ? blocks : blocks.filter((b) => b.topic === filter);
    const by = {};
    for (const b of list) (by[b.topic] = by[b.topic] ?? []).push(b);
    return Object.entries(by);
  }, [blocks, filter]);

  if (!blocks) return <div className="page center"><Spinner /></div>;

  return (
    <div className="page">
      <Reveal>
        <span className="eyebrow">⚙ Admin · content review</span>
        <h1 className="hero-title">Interactive library</h1>
        <p className="lede">
          Every interactive block OceanMind can put in a lesson, mapped to the source material it came from.
          Click any card to preview it live exactly as a learner sees it.
        </p>
        <p className="muted mt-1">{blocks.length} blocks · {new Set(blocks.map((b) => b.topic)).size} topic groups</p>
      </Reveal>

      <Reveal delay={100}>
        <div className="suggest-row" style={{ marginTop: '1.4rem' }}>
          <span className="suggest-label">Filter:</span>
          {['all', 'neural-networks', 'ai-agents', 'chatbots', 'any'].map((t) => (
            <button key={t} className="suggest-pill" onClick={() => setFilter(t)}
              style={filter === t ? { borderColor: 'var(--accent)', color: 'var(--accent-soft)', background: 'rgba(22,184,216,0.1)' } : {}}>
              {t === 'all' ? 'All' : TOPIC_LABEL[t]}
            </button>
          ))}
        </div>
      </Reveal>

      {groups.map(([topic, items]) => (
        <div key={topic} className="section-gap">
          <h2 style={{ fontSize: '1.2rem', color: '#fff', marginBottom: '1rem' }}>
            {TOPIC_LABEL[topic] ?? topic} <span className="muted" style={{ fontSize: '0.85rem' }}>· {items.length} blocks</span>
          </h2>
          {items.map((b, i) => (
            <Reveal key={b.type} delay={i * 40}>
              <div className="lib-card">
                <button className="lib-head" onClick={() => setOpen(open === b.type ? null : b.type)} aria-expanded={open === b.type}>
                  <span className="lib-title">
                    <b>{b.name}</b>
                    <code>{b.type}</code>
                  </span>
                  <span className="lib-desc">{b.desc}</span>
                  <span className="lib-source">📄 {b.source}</span>
                  <span className="chev" style={{ transform: open === b.type ? 'rotate(90deg)' : 'none' }}>▶</span>
                </button>
                {open === b.type && (
                  <div className="lib-preview">
                    <BlockRenderer block={b.sample} session={{ topicId: b.topic === 'any' ? 'neural-networks' : b.topic }} />
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      ))}

      <div className="center section-gap">
        <button className="btn btn--ghost" onClick={() => navigate('/admin')}>← Model settings</button>
      </div>
    </div>
  );
}
