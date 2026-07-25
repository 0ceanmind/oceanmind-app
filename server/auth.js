import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, T, getCookieSecret } from './db.js';

let SECRET = null;
async function secret() {
  if (!SECRET) SECRET = await getCookieSecret();
  return SECRET;
}

const COOKIE = 'om_uid';

async function sign(value) {
  return createHmac('sha256', await secret()).update(String(value)).digest('hex');
}

export async function setUserCookie(res, userId) {
  const value = `${userId}.${await sign(userId)}`;
  res.cookie(COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 90, // 90 days
  });
}

export function clearUserCookie(res) {
  res.clearCookie(COOKIE);
}

/** Parse + verify the signed cookie; returns the user row or null. */
export async function getUser(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(COOKIE.length + 1));
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = await sign(id);
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return (await db.get(`SELECT id, name, email FROM ${T.users} WHERE id = ?`, [Number(id)])) ?? null;
}

/** Express middleware: attaches req.user or responds 401. */
export async function requireUser(req, res, next) {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in first.' });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}
