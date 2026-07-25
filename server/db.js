/**
 * Dual-driver data layer with ONE async interface.
 *   - Local / dev / tests  → built-in node:sqlite (fast, zero deps, file-based)
 *   - Production (Vercel)   → Supabase Postgres, when DATABASE_URL is set
 *
 * Every call site uses the same async API: db.get / db.all / db.run / db.insert.
 * SQL is written once with `?` placeholders and CURRENT_TIMESTAMP; the Postgres
 * driver rewrites `?` → $1,$2,… . Tables are prefixed `om_` to coexist with
 * anything already in the shared Supabase project.
 */
import { randomBytes } from 'node:crypto';

const usePg = Boolean(process.env.DATABASE_URL);

// ---- shared schema, expressed per-driver ------------------------------------

const TABLES = ['users', 'learning_sessions', 'feedback', 'reports', 'notifications', 'projects', 'meta'];
export const T = Object.fromEntries(TABLES.map((t) => [t, `om_${t}`]));

function schemaSQL(pk, ts) {
  // pk = auto-increment primary-key clause; ts = current-timestamp default
  return `
  CREATE TABLE IF NOT EXISTS ${T.meta} (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ${T.users} (
    id ${pk},
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT ${ts}
  );
  CREATE TABLE IF NOT EXISTS ${T.learning_sessions} (
    id ${pk},
    user_id INTEGER NOT NULL REFERENCES ${T.users}(id),
    topic_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'assessment',
    score REAL,
    depth INTEGER,
    zone TEXT,
    assessment_answers TEXT,
    concept_scores TEXT,
    knowledge_map TEXT,
    questions TEXT,
    answered TEXT,
    lesson TEXT,
    summary TEXT,
    rebuilt_from INTEGER,
    support_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT ${ts},
    updated_at TIMESTAMPTZ NOT NULL DEFAULT ${ts}
  );
  CREATE TABLE IF NOT EXISTS ${T.feedback} (
    id ${pk},
    session_id INTEGER NOT NULL REFERENCES ${T.learning_sessions}(id),
    rating INTEGER NOT NULL,
    reasons TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT ${ts}
  );
  CREATE TABLE IF NOT EXISTS ${T.reports} (
    id ${pk},
    session_id INTEGER NOT NULL REFERENCES ${T.learning_sessions}(id),
    feedback_id INTEGER NOT NULL REFERENCES ${T.feedback}(id),
    status TEXT NOT NULL DEFAULT 'new',
    support_note TEXT,
    corrected_zone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT ${ts},
    resolved_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS ${T.projects} (
    id ${pk},
    user_id INTEGER NOT NULL REFERENCES ${T.users}(id),
    session_id INTEGER,
    topic_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT ${ts},
    updated_at TIMESTAMPTZ NOT NULL DEFAULT ${ts}
  );
  CREATE TABLE IF NOT EXISTS ${T.notifications} (
    id ${pk},
    user_id INTEGER NOT NULL REFERENCES ${T.users}(id),
    session_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    email_html TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT ${ts}
  );`;
}

// =============================================================================
// Postgres driver
// =============================================================================
let pgPool = null;
let schemaReady = null;

async function pgInit() {
  const { default: pg } = await import('pg');
  pgPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
}

// `?` → `$n`
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function pgEnsureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // GENERATED IDENTITY = Postgres auto-increment
      const stmts = schemaSQL('INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY', 'now()')
        .split(';').map((s) => s.trim()).filter(Boolean);
      for (const s of stmts) await pgPool.query(s);
      // lock the tables down to direct connections only (no anon REST access)
      for (const t of Object.values(T)) {
        await pgPool.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`).catch(() => {});
      }
    })();
  }
  return schemaReady;
}

// =============================================================================
// SQLite driver (local/dev/test)
// =============================================================================
let sqlite = null;

async function sqliteInit() {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');
  mkdirSync(dataDir, { recursive: true });
  sqlite = new DatabaseSync(join(dataDir, 'oceanmind.db'));
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const ddl = schemaSQL('INTEGER PRIMARY KEY AUTOINCREMENT', 'CURRENT_TIMESTAMP');
  sqlite.exec(ddl);
}

// =============================================================================
// public async API
// =============================================================================
let initPromise = null;
async function ready() {
  if (!initPromise) initPromise = usePg ? pgInit().then(pgEnsureSchema) : sqliteInit();
  return initPromise;
}

export const db = {
  driver: usePg ? 'postgres' : 'sqlite',

  async get(sql, params = []) {
    await ready();
    if (usePg) return (await pgPool.query(toPg(sql), params)).rows[0];
    return sqlite.prepare(sql).get(...params);
  },

  async all(sql, params = []) {
    await ready();
    if (usePg) return (await pgPool.query(toPg(sql), params)).rows;
    return sqlite.prepare(sql).all(...params);
  },

  async run(sql, params = []) {
    await ready();
    if (usePg) {
      const r = await pgPool.query(toPg(sql), params);
      return { changes: r.rowCount };
    }
    const r = sqlite.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  },

  /** INSERT that returns the new row id. `sql` must NOT include RETURNING. */
  async insert(sql, params = []) {
    await ready();
    if (usePg) {
      const r = await pgPool.query(`${toPg(sql)} RETURNING id`, params);
      return { id: r.rows[0].id };
    }
    const r = sqlite.prepare(sql).run(...params);
    return { id: Number(r.lastInsertRowid) };
  },
};

/** Persistent random secret used to sign session cookies (env overrides). */
export async function getCookieSecret() {
  if (process.env.COOKIE_SECRET) return process.env.COOKIE_SECRET;
  const row = await db.get(`SELECT value FROM ${T.meta} WHERE key = 'cookie_secret'`);
  if (row) return row.value;
  const secret = randomBytes(32).toString('hex');
  await db.run(`INSERT INTO ${T.meta} (key, value) VALUES ('cookie_secret', ?)`, [secret]);
  return secret;
}
