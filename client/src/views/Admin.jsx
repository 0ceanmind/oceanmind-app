import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Reveal, Spinner, useToast } from '../components/ui.jsx';

export default function Admin({ navigate, onConfigChanged }) {
  const toast = useToast();
  const [providers, setProviders] = useState(null);
  const [current, setCurrent] = useState(null);
  const [provider, setProvider] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/api/admin/config')
      .then((d) => {
        setProviders(d.providers);
        setCurrent(d.config);
        if (d.config) {
          setProvider(d.config.provider);
          setModel(d.config.model);
        }
      })
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  const pickProvider = (p) => {
    setProvider(p);
    setModel(providers[p].defaultModel);
    setTestResult(null);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api('/api/admin/test', { method: 'POST', body: { provider, apiKey, model } });
      setTestResult({ ok: true, text: `Connected! The model replied: “${r.sample}”` });
    } catch (e) {
      setTestResult({ ok: false, text: e.message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api('/api/admin/config', { method: 'POST', body: { provider, apiKey, model } });
      toast(`Model connected: ${r.config.provider} · ${r.config.model}`, 'success');
      setCurrent({ provider: r.config.provider, model: r.config.model, apiKeyMasked: '(saved)' });
      setApiKey('');
      onConfigChanged?.();
      navigate('/');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!providers) return <div className="page center"><Spinner /></div>;

  return (
    <div className="page page--narrow">
      <Reveal>
        <span className="eyebrow">⚙ Admin</span>
        <h1 className="hero-title">Connect a model</h1>
        <p className="lede">
          OceanMind is a real agent — every knowledge map, question, and lesson is generated
          live by the model you connect here. Your key is stored server-side only and never
          reaches the browser.
        </p>
        {current && (
          <p className="muted mt-1">
            Currently connected: <b style={{ color: 'var(--kelp)' }}>{providers[current.provider]?.label ?? current.provider}</b> · {current.model} · key {current.apiKeyMasked}
          </p>
        )}
      </Reveal>

      <Reveal delay={120}>
        <Card className="section-gap">
          <div className="field">
            <label>Provider</label>
            <div className="seg" role="group" aria-label="Provider">
              {Object.entries(providers).map(([id, p]) => (
                <button key={id} className={provider === id ? 'on' : ''} onClick={() => pickProvider(id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>API key</label>
            <input
              className="input" type="password" value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder={providers[provider].keyHint}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label>Model</label>
            <input
              className="input" value={model || providers[provider].defaultModel}
              onChange={(e) => { setModel(e.target.value); setTestResult(null); }}
              placeholder={providers[provider].defaultModel}
            />
            <p className="muted mt-1">
              {provider === 'openrouter'
                ? 'Any model id from openrouter.ai/models, e.g. "google/gemini-2.5-flash" or "anthropic/claude-haiku-4-5".'
                : provider === 'deepseek'
                  ? 'Pick your DeepSeek model, e.g. "deepseek-v4-flash" (fast) or "deepseek-v4-pro" (strong).'
                  : `Default: ${providers[provider].defaultModel}`}
            </p>
          </div>

          {testResult && (
            <p className={testResult.ok ? 'muted' : 'form-error'} role="status"
              style={testResult.ok ? { color: 'var(--kelp)', fontSize: '0.92rem' } : undefined}>
              {testResult.ok ? '✓ ' : ''}{testResult.text}
            </p>
          )}

          <div className="ctrl-row">
            <button className="btn" onClick={test} disabled={testing || !apiKey.trim()}>
              {testing ? <Spinner /> : '⚡ Test connection'}
            </button>
            <button className="btn btn--primary" onClick={save} disabled={saving || !apiKey.trim()}>
              {saving ? <Spinner /> : 'Save & connect'}
              {!saving && <span className="btn-orb">→</span>}
            </button>
          </div>
          {!apiKey.trim() && <p className="muted mt-1">Paste an API key to test and save.</p>}
        </Card>
      </Reveal>

      <Reveal delay={200}>
        <Card className="section-gap">
          <div className="row-between">
            <div>
              <b style={{ color: '#fff' }}>📚 Interactive content library</b>
              <p className="muted mt-1">Review every interactive block OceanMind can teach with, mapped to its source, and preview each one live.</p>
            </div>
            <button className="btn btn--primary" onClick={() => navigate('/admin/library')}>
              Open library <span className="btn-orb">→</span>
            </button>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
