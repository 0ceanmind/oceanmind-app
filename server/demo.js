// Local pitch-demo entry: `npm run demo` (serves the built client from
// client/dist on :3001) or `npm run demo:dev` (this server + the Vite dev
// server on :5173). Demo mode = the scripted replay provider plus a seeded
// in-memory SQLite DB, so it never touches real data, real keys or Postgres.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.OCEANMIND_DEMO = '1';
delete process.env.DATABASE_URL; // never Postgres in demo mode (db.js also refuses it)
delete process.env.OCEANMIND_TEST_AI; // the test mock would shadow the replay provider

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
if (!existsSync(dist) && !process.argv.includes('--dev')) {
  console.warn('client/dist is missing: run `npm run build` first, or use `npm run demo:dev` for the Vite dev server.');
}

// same bootstrap as `npm start` (Node version check, then startServer)
await import('./index.js');
