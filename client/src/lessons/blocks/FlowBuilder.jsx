import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Modal, Card, Md, Spinner, useToast } from '../../components/ui.jsx';

const NODE_TYPES = {
  trigger: {
    label: 'Trigger', icon: '⚡',
    hint: 'Where the run starts. It receives the test input you type in the toolbar and passes it to whatever it connects to.',
    requires: 'Nothing upstream — this is the entry point. Every flow needs exactly one.',
  },
  llm: {
    label: 'LLM step', icon: '✨',
    hint: 'Sends its incoming text to the connected model with your prompt, and passes the model’s reply onward.',
    requires: 'A connected model (Admin → Model) and an input wire. Write a clear prompt in the inspector.',
  },
  tool: {
    label: 'Tool', icon: '🔧',
    hint: 'Really executes a function on the server and returns the actual result — no hallucination.',
    requires: 'An input wire whose text suits the tool (e.g. an arithmetic expression for the calculator).',
  },
  output: {
    label: 'Output', icon: '📤',
    hint: 'Collects whatever reaches it as the flow’s final result. Shown in the run panel.',
    requires: 'At least one input wire. Nothing runs after it.',
  },
};
const TOOL_OPTIONS = [
  { id: 'calculator', desc: 'evaluates an arithmetic expression like "1200 + 80*8"' },
  { id: 'docsearch', desc: 'searches the course source documents and returns passages' },
  { id: 'notes', desc: 'appends its input to a scratchpad' },
  { id: 'clock', desc: 'returns the current date and time' },
];

const TEMPLATES = {
  starter: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 30, y: 150, config: { label: 'Incoming request' } },
      { id: 'n2', type: 'llm', x: 250, y: 150, config: { label: 'Process', prompt: 'Answer the incoming request helpfully in 2-3 sentences.' } },
      { id: 'n3', type: 'output', x: 470, y: 150, config: { label: 'Result' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }],
  },
  research: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 24, y: 60, config: { label: 'Research question' } },
      { id: 'n2', type: 'tool', x: 230, y: 60, config: { label: 'Search sources', tool: 'docsearch' } },
      { id: 'n3', type: 'llm', x: 440, y: 60, config: { label: 'Summarize', prompt: 'Summarize the retrieved passages into 3 bullet points answering the question.' } },
      { id: 'n4', type: 'output', x: 440, y: 240, config: { label: 'Summary' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }],
  },
  marketing: {
    nodes: [
      { id: 'n1', type: 'trigger', x: 24, y: 170, config: { label: 'Campaign brief' } },
      { id: 'n2', type: 'llm', x: 230, y: 60, config: { label: 'Audience analysis', prompt: 'From this campaign brief, identify the target audience and their 3 main pain points.' } },
      { id: 'n3', type: 'llm', x: 230, y: 280, config: { label: 'Copywriter', prompt: 'Write 2 short ad copy variants for this brief.' } },
      { id: 'n4', type: 'llm', x: 450, y: 170, config: { label: 'Campaign plan', prompt: 'Combine the audience analysis and ad copy into a one-paragraph launch plan.' } },
      { id: 'n5', type: 'output', x: 650, y: 170, config: { label: 'Launch plan' } },
    ],
    edges: [{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n3' }, { from: 'n2', to: 'n4' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }],
  },
};

let uid = 100;

export default function FlowBuilder({ template = 'starter', goalHint, topicId, sessionId }) {
  const toast = useToast();
  const canvasRef = useRef(null);
  const [nodes, setNodes] = useState(() => structuredClone(TEMPLATES[template]?.nodes ?? TEMPLATES.starter.nodes));
  const [edges, setEdges] = useState(() => structuredClone(TEMPLATES[template]?.edges ?? TEMPLATES.starter.edges));
  const [sel, setSel] = useState(null);
  const [arming, setArming] = useState(null);
  const [drag, setDrag] = useState(null);
  const [hoverTip, setHoverTip] = useState(null); // { node, x, y }
  const [input, setInput] = useState(goalHint ?? '');
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState({});
  const [guide, setGuide] = useState(null);
  const [guideBusy, setGuideBusy] = useState(false);
  const [canvasH, setCanvasH] = useState(440);
  const [projectId, setProjectId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 }); // pan (x,y) + zoom (k)
  const panRef = useRef(null);
  const resizeRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const selNode = nodes.find((n) => n.id === sel);

  // world coords from a pointer event (account for pan + zoom)
  const toWorld = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  };
  const clampZoom = (k) => Math.max(0.4, Math.min(2, k));

  const addNode = (type) => {
    const id = `n${++uid}`;
    setNodes((ns) => [...ns, {
      id, type, x: 60 + ((ns.length * 60) % 380), y: 50 + ((ns.length * 90) % 240),
      config: {
        label: NODE_TYPES[type].label,
        ...(type === 'llm' ? { prompt: 'Process the input and produce a useful result.' } : {}),
        ...(type === 'tool' ? { tool: 'calculator' } : {}),
      },
    }]);
    setSel(id);
  };
  const removeNode = (id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.from !== id && e.to !== id));
    if (sel === id) setSel(null);
  };
  const updateSel = (patch) => setNodes((ns) => ns.map((n) => (n.id === sel ? { ...n, config: { ...n.config, ...patch } } : n)));

  const onNodeDown = (e, id) => {
    if (e.target.classList.contains('fb-port')) return;
    e.stopPropagation();
    const node = nodes.find((n) => n.id === id);
    const w = toWorld(e.clientX, e.clientY);
    setSel(id);
    setDrag({ id, dx: w.x - node.x, dy: w.y - node.y });
  };

  // node dragging (in world space, so it tracks under the cursor at any zoom)
  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const w = toWorld(e.clientX, e.clientY);
      const x = Math.max(-200, Math.min(2000, w.x - drag.dx));
      const y = Math.max(-200, Math.min(2000, w.y - drag.dy));
      setNodes((ns) => ns.map((n) => (n.id === drag.id ? { ...n, x, y } : n)));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag]);

  // panning the canvas background
  const onCanvasDown = (e) => {
    if (e.target !== canvasRef.current && !e.target.classList.contains('fb-world')) return;
    setSel(null); setArming(null);
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  useEffect(() => {
    const move = (e) => {
      if (!panRef.current) return;
      setView((v) => ({ ...v, x: panRef.current.ox + (e.clientX - panRef.current.sx), y: panRef.current.oy + (e.clientY - panRef.current.sy) }));
    };
    const up = () => { panRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  // wheel zoom, centered on the cursor
  const onWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setView((v) => {
      const k = clampZoom(v.k * (e.deltaY < 0 ? 1.1 : 0.9));
      const ratio = k / v.k;
      return { k, x: mx - (mx - v.x) * ratio, y: my - (my - v.y) * ratio };
    });
  };
  const zoomBy = (f) => setView((v) => {
    const k = clampZoom(v.k * f);
    const cx = (canvasRef.current?.clientWidth ?? 400) / 2, cy = canvasH / 2;
    const ratio = k / v.k;
    return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
  });
  const resetView = () => setView({ x: 0, y: 0, k: 1 });

  // resize the workspace — reliable global listeners bound once
  useEffect(() => {
    const move = (e) => {
      const r = resizeRef.current;
      if (!r) return;
      setCanvasH(Math.max(300, Math.min(900, r.startH + (e.clientY - r.startY))));
    };
    const up = () => { resizeRef.current = null; document.body.style.userSelect = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  const startResize = (e) => {
    e.preventDefault();
    resizeRef.current = { startY: e.clientY, startH: canvasH };
    document.body.style.userSelect = 'none';
  };

  const clickOut = (id) => setArming(arming === id ? null : id);
  const clickIn = (id) => {
    if (!arming || arming === id) return;
    if (edges.some((e) => e.from === arming && e.to === id)) { setArming(null); return; }
    setEdges((es) => [...es, { from: arming, to: id }]);
    setArming(null);
    toast('Connected! Click any wire to remove it.', 'success');
  };

  const run = async () => {
    if (!input.trim()) { toast('Type a test input first — that’s what the Trigger receives.', 'error'); return; }
    setRunning(true);
    setTrace({});
    try {
      const r = await api('/api/flow/run', { method: 'POST', body: { nodes, edges, input } });
      for (const step of r.trace) {
        setTrace((t) => ({ ...t, [step.id]: { status: 'running' } }));
        // eslint-disable-next-line no-await-in-loop
        await new Promise((ok) => setTimeout(ok, 450));
        setTrace((t) => ({ ...t, [step.id]: step }));
      }
      if (r.error) toast(r.error, 'error');
      else toast('Flow completed — check each node’s output on the right.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const exportJson = () => {
    const data = { name: 'oceanmind-agent-flow', version: 1, nodes, edges, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-agent-flow.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Flow downloaded as my-agent-flow.json 📦', 'success');
  };

  const saveProject = async () => {
    setSaving(true);
    try {
      const name = selNode ? undefined : null;
      const defaultName = `Agent flow · ${new Date().toLocaleDateString()}`;
      const r = await api('/api/projects', {
        method: 'POST',
        body: { projectId, kind: 'flow', name: name ?? defaultName, topicId, sessionId, data: { nodes, edges } },
      });
      setProjectId(r.projectId);
      toast('Saved to your Projects library 🗂️', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const getGuide = async () => {
    setGuideBusy(true);
    try {
      const r = await api('/api/flow/guide', { method: 'POST', body: { nodes, edges } });
      setGuide(r.text);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setGuideBusy(false);
    }
  };

  const edgePath = (e) => {
    const a = nodes.find((n) => n.id === e.from);
    const b = nodes.find((n) => n.id === e.to);
    if (!a || !b) return '';
    const x1 = a.x + 148, y1 = a.y + 34, x2 = b.x, y2 = b.y + 34;
    return `M${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`;
  };

  const orderedResults = useMemo(
    () => nodes.filter((n) => trace[n.id]?.output !== undefined).map((n) => ({ node: n, ...trace[n.id] })),
    [nodes, trace]
  );

  const showTip = (node) => setHoverTip({ node, x: node.x + 156, y: node.y });

  return (
    <div className="block-frame">
      <div className="fb-wrap">
        <div className="fb-palette">
          <h4>Add a step</h4>
          {Object.entries(NODE_TYPES).map(([type, t]) => (
            <button key={type} className="fb-pal-item" onClick={() => addNode(type)} title={t.hint}>
              {t.icon} {t.label}
            </button>
          ))}
          <h4 style={{ marginTop: '0.9rem' }}>Templates</h4>
          {Object.keys(TEMPLATES).map((k) => (
            <button key={k} className="fb-pal-item" onClick={() => {
              setNodes(structuredClone(TEMPLATES[k].nodes));
              setEdges(structuredClone(TEMPLATES[k].edges));
              setTrace({}); setSel(null);
            }}>📋 {k}</button>
          ))}
        </div>

        <div className="fb-stage">
          <div className="fb-canvas" ref={canvasRef} style={{ height: canvasH }}
            onPointerDown={onCanvasDown} onWheel={onWheel}>
            <div className="fb-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
              <svg className="fb-edges" width="3000" height="3000">
                <defs>
                  <marker id="fbArr" markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
                    <path d="M0 0 L7 3.5 L0 7 z" fill="#16b8d8" />
                  </marker>
                </defs>
                {edges.map((e, i) => (
                  <path key={i} d={edgePath(e)} fill="none" stroke="rgba(22,184,216,0.7)" strokeWidth="2.2"
                    className="flow-anim" markerEnd="url(#fbArr)"
                    onClick={() => setEdges((es) => es.filter((_, j) => j !== i))}>
                    <title>Click to disconnect</title>
                  </path>
                ))}
              </svg>
              {nodes.map((n) => {
                const tr = trace[n.id];
                return (
                  <div key={n.id}
                    className={`fb-node ${sel === n.id ? 'selected' : ''} ${tr?.status === 'running' ? 'running' : tr?.status === 'ok' ? 'did-run' : tr?.status === 'error' ? 'error' : ''}`}
                    style={{ left: n.x, top: n.y }}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onMouseEnter={() => showTip(n)} onMouseLeave={() => setHoverTip(null)}>
                    {n.type !== 'trigger' && <span className="fb-port in" title="Input" onClick={(e) => { e.stopPropagation(); clickIn(n.id); }} />}
                    {n.type !== 'output' && <span className={`fb-port out ${arming === n.id ? 'armed' : ''}`} title="Click to start a connection" onClick={(e) => { e.stopPropagation(); clickOut(n.id); }} />}
                    <div className="fb-node-head">
                      {NODE_TYPES[n.type].icon} {n.config.label}
                      <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={(e) => { e.stopPropagation(); removeNode(n.id); }} aria-label="Delete node">✕</button>
                    </div>
                    <div className="fb-node-body">
                      {n.type === 'llm' ? n.config.prompt : n.type === 'tool' ? `tool: ${n.config.tool}` : NODE_TYPES[n.type].hint}
                    </div>
                  </div>
                );
              })}
              {hoverTip && (
                <div className="fb-tip" style={{ left: hoverTip.x, top: hoverTip.y }}>
                  <b>{NODE_TYPES[hoverTip.node.type].icon} {NODE_TYPES[hoverTip.node.type].label}</b>
                  <p>{NODE_TYPES[hoverTip.node.type].hint}</p>
                  <p className="fb-tip-req"><b>Needs:</b> {NODE_TYPES[hoverTip.node.type].requires}</p>
                  {hoverTip.node.type === 'tool' && (
                    <p className="fb-tip-req"><b>This tool:</b> {TOOL_OPTIONS.find((t) => t.id === hoverTip.node.config.tool)?.desc}</p>
                  )}
                </div>
              )}
            </div>

            {/* fixed overlay controls (not affected by pan/zoom) */}
            <div className="fb-zoom">
              <button className="icon-btn" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">＋</button>
              <span title="Current zoom">{Math.round(view.k * 100)}%</span>
              <button className="icon-btn" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">－</button>
              <button className="icon-btn" onClick={resetView} title="Reset view" aria-label="Reset view">⤢</button>
            </div>
            {arming && <div className="fb-arming">Now click a target node’s left port to connect ⚡</div>}
            {/* corner + edge resize handles */}
            <div className="fb-resize-corner" onPointerDown={startResize} title="Drag to resize the workspace" />
          </div>
          <div className="fb-resize-bar" onPointerDown={startResize} title="Drag to resize the workspace">⋯</div>
        </div>

        <div className="fb-inspector">
          {selNode ? (
            <>
              <h4>{NODE_TYPES[selNode.type].icon} {NODE_TYPES[selNode.type].label}</h4>
              <p className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.7rem', lineHeight: 1.45 }}>{NODE_TYPES[selNode.type].hint}</p>
              <div className="field">
                <label>Name</label>
                <input className="input" value={selNode.config.label} onChange={(e) => updateSel({ label: e.target.value })} maxLength={40} />
              </div>
              {selNode.type === 'llm' && (
                <div className="field">
                  <label>Prompt</label>
                  <textarea className="textarea" style={{ minHeight: '5rem', fontSize: '0.82rem' }}
                    value={selNode.config.prompt} onChange={(e) => updateSel({ prompt: e.target.value })} maxLength={600} />
                </div>
              )}
              {selNode.type === 'tool' && (
                <div className="field">
                  <label>Tool</label>
                  <select className="select" value={selNode.config.tool} onChange={(e) => updateSel({ tool: e.target.value })}>
                    {TOOL_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
                  </select>
                  <p className="muted mt-1" style={{ fontSize: '0.76rem' }}>{TOOL_OPTIONS.find((t) => t.id === selNode.config.tool)?.desc}</p>
                </div>
              )}
            </>
          ) : (
            <>
              <h4>Run results</h4>
              {orderedResults.length === 0 && <p className="muted" style={{ fontSize: '0.82rem' }}>Hover a node for how it works. Select one to edit it, or Run the flow to see each step’s real output.</p>}
              {orderedResults.map(({ node, status, output }) => (
                <div key={node.id} className="fb-result">
                  <b>{NODE_TYPES[node.type].icon} {node.config.label} {status === 'error' ? '⛔' : '✓'}</b>
                  {String(output).slice(0, 400)}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="fb-toolbar">
        <input className="input" style={{ flex: 1, minWidth: 200 }} value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Test input for the Trigger — e.g. “Launch our new eco water bottle”" maxLength={300} />
        <button className="btn btn--primary" onClick={run} disabled={running}>{running ? <Spinner /> : '▶ Run flow'}</button>
        <button className="btn" onClick={saveProject} disabled={saving}>{saving ? <Spinner /> : projectId ? '💾 Update' : '🗂️ Save to Projects'}</button>
        <button className="btn btn--ghost" onClick={exportJson}>⬇ JSON</button>
        <button className="btn btn--ghost" onClick={getGuide} disabled={guideBusy}>{guideBusy ? <Spinner /> : '🔌 Integration guide'}</button>
      </div>
      <p className="block-hint">
        Build it like Zapier: drag nodes, wire outputs → inputs, <b>drag the empty canvas to pan</b>,
        <b> scroll or ＋/－ to zoom</b>, and drag the bottom/corner to resize. Hover any node for how it works.
        <b> Run</b> executes for real; <b>Save to Projects</b> keeps it.
      </p>

      {guide && (
        <Modal onClose={() => setGuide(null)}>
          <Card>
            <div className="row-between" style={{ marginBottom: '0.8rem' }}>
              <b>🔌 Integrating this flow into your own product</b>
              <button className="btn btn--ghost" onClick={() => setGuide(null)}>Close ✕</button>
            </div>
            <Md text={guide} />
          </Card>
        </Modal>
      )}
    </div>
  );
}
