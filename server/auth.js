// Acceso protegido: contraseña de editor (planificar) y, opcionalmente, contraseña o enlace
// con token para la pantalla de solo visualización. Sesiones en servidor + cookie HttpOnly.
import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './db.js';

const COOKIE = 'd2k_sid';
const attempts = new Map(); // ip -> { n, first }

const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(h(a), h(b));

export function checkPassword(pw) {
  if (config.auth.editorPassword && safeEq(pw, config.auth.editorPassword)) return 'editor';
  if (config.auth.viewerPassword && safeEq(pw, config.auth.viewerPassword)) return 'viewer';
  return null;
}

export function checkDisplayToken(tok) {
  return !!(config.auth.displayToken && tok && safeEq(tok, config.auth.displayToken));
}

export function rateLimited(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > 15 * 60_000) { attempts.set(ip, { n: 1, first: now }); return false; }
  a.n += 1;
  return a.n > 10;
}
export function resetAttempts(ip) { attempts.delete(ip); }

function sign(id) {
  return crypto.createHmac('sha256', config.auth.sessionSecret).update(id).digest('base64url');
}

export function createSession(res, role) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const maxAge = config.auth.sessionDays * 86400_000;
  db.prepare('INSERT INTO sessions (id, role, created_at, expires_at) VALUES (?,?,?,?)').run(id, role, now, now + maxAge);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  res.cookie(COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true, sameSite: 'lax', secure: config.auth.cookieSecure, maxAge, path: '/',
  });
}

export function destroySession(req, res) {
  const s = readSession(req);
  if (s) db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
  res.clearCookie(COOKIE, { path: '/' });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function readSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig) return null;
  const expected = sign(id);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const row = db.prepare('SELECT id, role, expires_at FROM sessions WHERE id = ?').get(id);
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

export function requireAuth(req, res, next) {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'No autenticado' });
  req.session = s;
  next();
}

/** Escrituras: rol editor + cabecera anti-CSRF (los formularios de otros sitios no pueden enviarla). */
export function requireEditor(req, res, next) {
  if (req.session?.role !== 'editor') return res.status(403).json({ error: 'Solo lectura: esta sesión no puede editar.' });
  if (req.get('X-D2K') !== '1') return res.status(403).json({ error: 'Petición no válida' });
  next();
}
