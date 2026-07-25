/**
 * Multi-provider LLM layer. The provider + API key + model are configured in
 * the admin page and stored in the database (meta table). Supported providers:
 *   - gemini      (Google AI Studio keys)
 *   - anthropic   (Anthropic API keys)
 *   - openrouter  (OpenRouter keys — any model on openrouter.ai)
 *   - mock        (deterministic test provider; only enabled with OCEANMIND_TEST_AI=1)
 *
 * Keys never reach the client. All calls go through aiChat/aiJson.
 */
import { db, T } from './db.js';
import { mockChat } from './aimock.js';

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    keyHint: 'AIza… key from aistudio.google.com',
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultModel: 'claude-haiku-4-5',
    keyHint: 'sk-ant-… key from console.anthropic.com',
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash',
    keyHint: 'sk-… key from platform.deepseek.com',
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'google/gemini-2.5-flash',
    keyHint: 'sk-or-… key from openrouter.ai',
  },
};

const CONFIG_KEY = 'ai_config';

/** Config precedence: test mock → env vars (Vercel) → DB (admin page). */
function envConfig() {
  const envKey = process.env.OCEANMIND_AI_KEY
    || process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY
    || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!envKey) return null;
  const provider = process.env.OCEANMIND_AI_PROVIDER
    || (process.env.DEEPSEEK_API_KEY && 'deepseek')
    || (process.env.GEMINI_API_KEY && 'gemini')
    || (process.env.ANTHROPIC_API_KEY && 'anthropic')
    || (process.env.OPENROUTER_API_KEY && 'openrouter');
  if (!PROVIDERS[provider]) return null;
  return { provider, apiKey: envKey.trim(), model: (process.env.OCEANMIND_AI_MODEL || PROVIDERS[provider].defaultModel).trim(), fromEnv: true };
}

export async function getAiConfig() {
  if (process.env.OCEANMIND_TEST_AI === '1') return { provider: 'mock', apiKey: 'test', model: 'mock-1' };
  const env = envConfig();
  if (env) return env;
  const row = await db.get(`SELECT value FROM ${T.meta} WHERE key = ?`, [CONFIG_KEY]);
  if (!row) return null;
  try {
    const cfg = JSON.parse(row.value);
    return cfg?.provider && cfg?.apiKey && cfg?.model ? cfg : null;
  } catch {
    return null;
  }
}

export async function setAiConfig({ provider, apiKey, model }) {
  if (!PROVIDERS[provider]) throw Object.assign(new Error('Unknown provider.'), { status: 400 });
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    throw Object.assign(new Error('That API key looks too short.'), { status: 400 });
  }
  const cfg = { provider, apiKey: apiKey.trim(), model: (model || PROVIDERS[provider].defaultModel).trim() };
  await db.run(
    `INSERT INTO ${T.meta} (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [CONFIG_KEY, JSON.stringify(cfg)]
  );
  return cfg;
}

export async function aiIsConfigured() {
  return (await getAiConfig()) !== null;
}

/** Public, key-masked view for the admin page. */
export async function maskedConfig() {
  const cfg = await getAiConfig();
  if (!cfg) return null;
  const k = cfg.apiKey;
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKeyMasked: k.length > 9 ? `${k.slice(0, 6)}…${k.slice(-4)}` : '•••',
    fromEnv: Boolean(cfg.fromEnv),
  };
}

function httpError(status, providerLabel, bodyText) {
  const friendly =
    status === 401 || status === 403
      ? `${providerLabel} rejected the API key (HTTP ${status}). Check the key in Admin → Model.`
      : status === 429
        ? `${providerLabel} is rate-limiting right now (HTTP 429). Wait a moment and try again.`
        : status === 404
          ? `${providerLabel} doesn't know that model name (HTTP 404). Check the model in Admin → Model.`
          : `${providerLabel} request failed (HTTP ${status}).`;
  const err = new Error(friendly);
  err.status = 502;
  err.upstream = bodyText?.slice(0, 400);
  return err;
}

/**
 * Provider-agnostic chat call.
 * @param {string} system
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {object} [opts]  { maxTokens, json } — json:true asks the provider for JSON output where supported
 * @returns {Promise<string>}
 */
export async function aiChat(system, messages, opts = {}) {
  const cfg = opts.cfg ?? (await getAiConfig());
  if (!cfg) {
    const err = new Error('No AI model is connected yet. Open Admin → Model and add an API key.');
    err.status = 503;
    throw err;
  }
  const maxTokens = opts.maxTokens ?? 3000;

  if (cfg.provider === 'mock') return mockChat(system, messages);

  if (cfg.provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: maxTokens,
          ...(opts.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
    if (!res.ok) throw httpError(res.status, 'Gemini', await res.text().catch(() => ''));
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (!text) {
      const reason = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? 'empty response';
      throw Object.assign(new Error(`Gemini returned no text (${reason}). Try again.`), { status: 502 });
    }
    return text;
  }

  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages }),
    });
    if (!res.ok) throw httpError(res.status, 'Anthropic', await res.text().catch(() => ''));
    const data = await res.json();
    return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  if (cfg.provider === 'openrouter' || cfg.provider === 'deepseek') {
    const label = cfg.provider === 'deepseek' ? 'DeepSeek' : 'OpenRouter';
    const url = cfg.provider === 'deepseek'
      ? 'https://api.deepseek.com/chat/completions'
      : 'https://openrouter.ai/api/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        ...(cfg.provider === 'openrouter' ? { 'x-title': 'OceanMind' } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw httpError(res.status, label, await res.text().catch(() => ''));
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw Object.assign(new Error(`${label} returned no text. Try again.`), { status: 502 });
    return text;
  }

  throw Object.assign(new Error('Unknown provider configured.'), { status: 500 });
}

/** Extract the first JSON object/array from model output (handles ```json fences). */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model output.');
  // walk to the matching close bracket
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === open) depth++;
    if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in model output.');
}

/**
 * Chat call that must return JSON matching `validate`. Retries once with the
 * parse error appended, then fails loudly (no silent fallback content).
 */
export async function aiJson(system, userPrompt, validate, opts = {}) {
  let lastErr;
  let prompt = userPrompt;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await aiChat(system, [{ role: 'user', content: prompt }], { ...opts, json: true });
    try {
      const parsed = extractJson(text);
      const problem = validate ? validate(parsed) : null;
      if (problem) throw new Error(problem);
      return parsed;
    } catch (e) {
      lastErr = e;
      prompt = `${userPrompt}\n\nYour previous reply could not be used: ${e.message}\nReply again with ONLY valid JSON in exactly the requested shape.`;
    }
  }
  const err = new Error(`The model kept returning invalid data (${lastErr.message}). Please try again.`);
  err.status = 502;
  throw err;
}

/** Admin "Test connection": round-trip against the proposed config, no persistence. */
export async function testConfig({ provider, apiKey, model }) {
  if (!PROVIDERS[provider]) throw Object.assign(new Error('Unknown provider.'), { status: 400 });
  if (typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    throw Object.assign(new Error('That API key looks too short.'), { status: 400 });
  }
  const cfg = { provider, apiKey: apiKey.trim(), model: (model || PROVIDERS[provider].defaultModel).trim() };
  const text = await aiChat('Reply with exactly: OK', [{ role: 'user', content: 'ping' }], { maxTokens: 1000, cfg });
  return { ok: true, sample: text.trim().slice(0, 60) };
}
