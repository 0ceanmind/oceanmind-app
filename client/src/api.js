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

/** Thin fetch wrapper: JSON in/out, throws Error with a friendly message. */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Can’t reach the OceanMind server. Is it running?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}
