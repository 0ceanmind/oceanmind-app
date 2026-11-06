/** Parse a timestamp from either SQLite ("2026-07-22 11:50:47" UTC) or Postgres
 *  (ISO with Z, or "2026-07-25 14:38:25+00"). Try native parse first. */
export function parseTs(s) {
  if (!s) return new Date(NaN);
  if (s instanceof Date) return s;
  const str = String(s);
  // Postgres/ISO forms carry a timezone marker (T, Z, or a +/- offset)
  if (/[TZ]|[+-]\d\d(:?\d\d)?$/.test(str)) {
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) return d;
    const d2 = new Date(str.replace(' ', 'T'));
    if (!Number.isNaN(d2.getTime())) return d2;
  }
  // bare "YYYY-MM-DD HH:MM:SS" from SQLite is UTC
  return new Date(str.replace(' ', 'T') + 'Z');
}

/* ------------------------------------------------------------ net tracking */

// Every request goes through api(), so this is the one place that knows
// whether the app is still talking to the server. The demo director waits on
// "network idle" instead of guessing with fixed sleeps.
let inflight = 0;
let seq = 0;
let lastEndAt = 0;
const netListeners = new Set();

/** Subscribe to request start/end: fn({ phase, id, method, path, status, ok, ms, inflight }). Returns unsubscribe. */
export function onNet(fn) {
  netListeners.add(fn);
  return () => netListeners.delete(fn);
}

/** Snapshot of the network state: { inflight, lastEndAt }. */
export function netState() {
  return { inflight, lastEndAt };
}

function emitNet(detail) {
  const payload = { ...detail, inflight };
  for (const fn of netListeners) {
    try { fn(payload); } catch { /* a listener must never break a request */ }
  }
  try {
    window.dispatchEvent(new CustomEvent('om-net', { detail: payload }));
  } catch { /* non-browser (tests) */ }
}

/**
 * Resolve true once no request has been in flight for `quietMs` in a row;
 * resolve false if that never happens within `timeout`. Rejects with an
 * AbortError if `signal` aborts. Runs on setTimeout (works in hidden tabs).
 */
export function waitForNetworkIdle(quietMs = 300, { timeout = 20000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const check = () => {
      const now = performance.now();
      if (inflight === 0 && now - lastEndAt >= quietMs) {
        signal?.removeEventListener('abort', onAbort);
        return resolve(true);
      }
      if (now - start >= timeout) {
        signal?.removeEventListener('abort', onAbort);
        return resolve(false);
      }
      timer = setTimeout(check, 40);
    };
    check();
  });
}

/* ------------------------------------------------- demo session self-healing */

// Demo mode only (the server decides: it is the only one that sends `_row`
// and DEMO_SESSION_MISSING). Serverless instances each hold their own
// in-memory database, so a session created on one may be missing on the next.
// We keep the latest raw row per session and put it back when that happens.
const ROW_KEY = 'om-demo-row:';
const rowCache = new Map();

function rememberRow(row) {
  if (!row || typeof row !== 'object' || row.id == null) return;
  const id = String(row.id);
  rowCache.set(id, row);
  try { sessionStorage.setItem(ROW_KEY + id, JSON.stringify(row)); } catch { /* storage full or blocked */ }
}

function cachedRow(id) {
  if (id == null) return null;
  const key = String(id);
  if (rowCache.has(key)) return rowCache.get(key);
  try {
    const raw = sessionStorage.getItem(ROW_KEY + key);
    if (raw) {
      const row = JSON.parse(raw);
      rowCache.set(key, row);
      return row;
    }
  } catch { /* ignore */ }
  return null;
}

/** Pull `_row`/`_rows` out of a response (top level or under `session`) and cache them. */
function harvestRows(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!('_row' in data) && !('_rows' in data) && !(data.session && typeof data.session === 'object' && '_row' in data.session)) {
    return data;
  }
  const out = { ...data };
  if ('_row' in out) { rememberRow(out._row); delete out._row; }
  if ('_rows' in out) { (Array.isArray(out._rows) ? out._rows : []).forEach(rememberRow); delete out._rows; }
  if (out.session && typeof out.session === 'object' && '_row' in out.session) {
    const { _row, ...session } = out.session;
    rememberRow(_row);
    out.session = session;
  }
  return out;
}

function sessionIdFor(path, body, errData) {
  const m = /^\/api\/sessions\/([^/?#]+)/.exec(path);
  if (m) return decodeURIComponent(m[1]);
  return body?.sessionId ?? errData?.sessionId ?? null;
}

async function restoreRow(row) {
  try {
    const res = await fetch('/api/demo/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ row }),
      credentials: 'same-origin',
    });
    if (!res.ok) return false;
    try { harvestRows(await res.json()); } catch { /* restore may answer without a body */ }
    return true;
  } catch {
    return false;
  }
}

function parseRowValue(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return v;
  try { return JSON.parse(s); } catch { return v; }
}

/**
 * Demo only: the latest raw om_learning_sessions row the server sent for this
 * session, with JSON columns parsed (questions with correctIndex, answered,
 * lesson, knowledge_map, summary …). Column names stay as in the database
 * (snake_case). Returns null when nothing is cached (e.g. normal mode).
 */
export function getSessionRow(id) {
  const row = cachedRow(id);
  if (!row) return null;
  const parsed = {};
  for (const [k, v] of Object.entries(row)) parsed[k] = parseRowValue(v);
  return parsed;
}

/** Demo only: refetch the session (which refreshes the cached row) and return getSessionRow(id). */
export async function loadSessionRow(id) {
  await api(`/api/sessions/${encodeURIComponent(id)}`);
  return getSessionRow(id);
}

/** Forget every cached demo row (used by the director's full restart). */
export function clearSessionRows() {
  rowCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(ROW_KEY)) sessionStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

/* -------------------------------------------------------------------- api */

async function request(path, { method = 'GET', body, signal } = {}, attempt = 0, meta = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new Error('Can’t reach the OceanMind server. Is it running?');
  }
  meta.status = res.status;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    // Demo self-healing: the session lives on another instance — put it back once, then retry.
    if (attempt === 0 && res.status === 404 && data?.code === 'DEMO_SESSION_MISSING') {
      const row = cachedRow(sessionIdFor(path, body, data));
      if (row && (await restoreRow(row))) {
        meta.restored = true;
        return request(path, { method, body, signal }, 1, meta);
      }
    }
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    if (data?.code) err.code = data.code;
    throw err;
  }
  return harvestRows(data);
}

/** Thin fetch wrapper: JSON in/out, throws Error with a friendly message. */
export async function api(path, opts = {}) {
  const id = ++seq;
  const method = opts.method ?? 'GET';
  const t0 = performance.now();
  inflight += 1;
  emitNet({ phase: 'start', id, method, path });
  const meta = { status: 0, restored: false };
  let ok = false;
  try {
    const data = await request(path, opts, 0, meta);
    ok = true;
    return data;
  } finally {
    inflight = Math.max(0, inflight - 1);
    lastEndAt = performance.now();
    emitNet({ phase: 'end', id, method, path, status: meta.status, ok, restored: meta.restored, ms: Math.round(lastEndAt - t0) });
  }
}
