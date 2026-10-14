import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config, validateConfig } from './config.js';
import { db, tx, kv } from './db.js';
import {
  checkPassword, checkDisplayToken, createSession, destroySession, readSession,
  requireAuth, requireEditor, rateLimited, resetAttempts,
} from './auth.js';
import { getDay, findCachedEvent, providerStatus, startPolling, calendarEvents } from './calendar/service.js';
import { googleMode, oauthAuthUrl, oauthExchange, oauthDisconnect } from './calendar/google.js';
import { isValidDate, todayIn } from './time.js';

const errors = validateConfig();
if (errors.length) {
  console.error('Configuración incompleta:\n - ' + errors.join('\n - ') + '\nRevisa el fichero .env (ver .env.example).');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);
app.use(express.json({ limit: '50kb' }));

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});

// ---------- Ayudantes de datos --------------------------------------------------------

const toTech = (r) => ({ ...r, has_license: !!r.has_license, active: !!r.active });
const toVan = (r) => ({ ...r, active: !!r.active });

function resources() {
  return {
    profiles: db.prepare('SELECT * FROM profiles ORDER BY sort, name').all(),
    techs: db.prepare('SELECT * FROM technicians ORDER BY sort, id').all().map(toTech),
    vanTypes: db.prepare('SELECT * FROM van_types ORDER BY sort, name').all(),
    vans: db.prepare('SELECT * FROM vans ORDER BY sort, id').all().map(toVan),
  };
}

function plansFor(date) {
  const plans = {};
  const get = (id) => (plans[id] ||= { techs: [], vans: [], completed: false });
  for (const r of db.prepare('SELECT event_id, resource_type, resource_id FROM assignments WHERE event_date = ? ORDER BY created_at, rowid').all(date)) {
    get(r.event_id)[r.resource_type === 'tech' ? 'techs' : 'vans'].push(r.resource_id);
  }
  for (const r of db.prepare('SELECT event_id, completed FROM job_plans WHERE event_date = ?').all(date)) {
    if (r.completed || plans[r.event_id]) get(r.event_id).completed = !!r.completed;
  }
  return plans;
}

function hasDriver(date, eventId) {
  return !!db.prepare(`SELECT 1 FROM assignments a JOIN technicians t ON t.id = a.resource_id
    WHERE a.event_date = ? AND a.event_id = ? AND a.resource_type = 'tech' AND t.has_license = 1 LIMIT 1`).get(date, eventId);
}

/** Si un grupo marcado como completo se queda sin conductor, deja de estar completo. */
function recheckCompleted(date, eventId) {
  if (!hasDriver(date, eventId)) {
    db.prepare('UPDATE job_plans SET completed = 0, updated_at = datetime(\'now\') WHERE event_date = ? AND event_id = ?').run(date, eventId);
  }
}

function snapshotJob(date, ev) {
  db.prepare(`INSERT INTO job_plans (event_id, event_date, event_title, event_start, event_end) VALUES (?,?,?,?,?)
    ON CONFLICT(event_id, event_date) DO UPDATE SET event_title = excluded.event_title, event_start = excluded.event_start,
    event_end = excluded.event_end, updated_at = datetime('now')`)
    .run(ev.id, date, ev.title, String(ev.allDay ? ev.startDate : ev.start), String(ev.allDay ? ev.endDate : ev.end));
}

function cleanupJob(date, eventId) {
  const left = db.prepare('SELECT 1 FROM assignments WHERE event_date = ? AND event_id = ? LIMIT 1').get(date, eventId);
  const row = db.prepare('SELECT completed FROM job_plans WHERE event_date = ? AND event_id = ?').get(date, eventId);
  if (!left && row && !row.completed) db.prepare('DELETE FROM job_plans WHERE event_date = ? AND event_id = ?').run(date, eventId);
}

const resourceExists = (type, id) => !!db.prepare(`SELECT 1 FROM ${type === 'tech' ? 'technicians' : 'vans'} WHERE id = ? AND active = 1`).get(id);

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

async function requireEvent(date, eventId) {
  if (!isValidDate(date)) throw new HttpError(400, 'Fecha no válida');
  if (typeof eventId !== 'string' || !eventId || eventId.length > 1024) throw new HttpError(400, 'Trabajo no válido');
  let ev = findCachedEvent(date, eventId);
  if (!ev) { await getDay(date); ev = findCachedEvent(date, eventId); }
  if (!ev) throw new HttpError(404, 'Ese trabajo ya no aparece en el calendario para ese día. Actualiza la vista.', 'EVENT_GONE');
  return ev;
}

function parseResource(body) {
  const type = body.type;
  const id = Number(body.resourceId);
  if (!['tech', 'van'].includes(type) || !Number.isInteger(id)) throw new HttpError(400, 'Recurso no válido');
  return { type, id };
}

// ---------- Tiempo real (SSE) -----------------------------------------------------------

const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
calendarEvents.on('day-changed', (d) => broadcast('day-changed', d));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!(e instanceof HttpError)) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Error interno', code: e.code });
});

// ---------- Autenticación ---------------------------------------------------------------

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (rateLimited(ip)) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  const role = checkPassword(String(req.body?.password || ''));
  if (!role) return res.status(401).json({ error: 'Contraseña incorrecta' });
  resetAttempts(ip);
  createSession(res, role);
  res.json({ role });
});

app.post('/api/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

// Enlace para televisores: /pantalla?k=TOKEN crea una sesión de solo lectura.
app.get('/pantalla', (req, res, next) => {
  if (req.query.k) {
    if (!checkDisplayToken(String(req.query.k))) return res.status(403).send('Enlace no válido');
    createSession(res, 'viewer');
    return res.redirect('/pantalla');
  }
  next();
});

// Páginas: sin sesión -> login.
app.get(['/', '/pantalla', '/ajustes'], (req, res) => {
  if (!readSession(req)) return res.redirect('/login.html');
  res.sendFile(path.join(PUBLIC, 'index.html'));
});
app.use(express.static(PUBLIC, { index: false, maxAge: '5m' }));

// ---------- API (requiere sesión) -------------------------------------------------------

app.use('/api', requireAuth);

app.get('/api/me', (req, res) => {
  res.json({ role: req.session.role, today: todayIn(config.timeZone), timeZone: config.timeZone, status: providerStatus() });
});

app.get('/api/resources', (req, res) => res.json(resources()));

app.get('/api/day', wrap(async (req, res) => {
  const date = String(req.query.date || todayIn(config.timeZone));
  if (!isValidDate(date)) throw new HttpError(400, 'Fecha no válida');
  const force = req.query.refresh === '1';
  const entry = await getDay(date, { force });
  const plans = plansFor(date);
  const ids = new Set(entry.events.map((e) => e.id));
  // Trabajos con planificación cuyo evento ya no está ese día (movido o borrado en el calendario).
  let orphans = [];
  if (entry.syncedAt && !entry.error) {
    const titles = Object.fromEntries(db.prepare('SELECT event_id, event_title FROM job_plans WHERE event_date = ?').all(date).map((r) => [r.event_id, r.event_title]));
    orphans = [...new Set([...Object.keys(titles), ...Object.keys(plans)])]
      .filter((id) => !ids.has(id))
      .map((id) => ({ eventId: id, title: titles[id] || null, plan: plans[id] || { techs: [], vans: [], completed: false } }));
  }
  res.json({
    date, today: todayIn(config.timeZone), events: entry.events, syncedAt: entry.syncedAt,
    error: entry.error, plans, orphans, status: providerStatus(),
  });
}));

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// ---------- Escrituras: SOLO en la planificación interna -------------------------------

app.post('/api/assign', requireEditor, wrap(async (req, res) => {
  const { date, eventId, fromEventId, replace } = req.body || {};
  const ev = await requireEvent(date, eventId);
  const { type, id } = parseResource(req.body);
  if (!resourceExists(type, id)) throw new HttpError(404, 'Recurso no encontrado o inactivo');
  tx(() => {
    if (fromEventId && fromEventId !== eventId) {
      db.prepare('DELETE FROM assignments WHERE event_date = ? AND event_id = ? AND resource_type = ? AND resource_id = ?').run(date, fromEventId, type, id);
      if (type === 'tech') recheckCompleted(date, fromEventId);
      cleanupJob(date, fromEventId);
    }
    if (type === 'van' && replace) {
      db.prepare("DELETE FROM assignments WHERE event_date = ? AND event_id = ? AND resource_type = 'van' AND resource_id <> ?").run(date, eventId, id);
    }
    snapshotJob(date, ev);
    db.prepare('INSERT OR IGNORE INTO assignments (event_id, event_date, resource_type, resource_id) VALUES (?,?,?,?)').run(eventId, date, type, id);
  });
  broadcast('plan-changed', { date });
  res.json({ plans: plansFor(date) });
}));

app.post('/api/unassign', requireEditor, wrap(async (req, res) => {
  const { date, eventId } = req.body || {};
  if (!isValidDate(date) || typeof eventId !== 'string') throw new HttpError(400, 'Datos no válidos');
  const { type, id } = parseResource(req.body);
  tx(() => {
    db.prepare('DELETE FROM assignments WHERE event_date = ? AND event_id = ? AND resource_type = ? AND resource_id = ?').run(date, eventId, type, id);
    if (type === 'tech') recheckCompleted(date, eventId);
    cleanupJob(date, eventId);
  });
  broadcast('plan-changed', { date });
  res.json({ plans: plansFor(date) });
}));

// Fija el grupo completo de un trabajo (selector accesible / sugerencias del título).
app.put('/api/plan', requireEditor, wrap(async (req, res) => {
  const { date, eventId } = req.body || {};
  const ev = await requireEvent(date, eventId);
  const ids = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter(Number.isInteger))];
  const techs = ids(req.body.techs).filter((id) => resourceExists('tech', id));
  const vans = ids(req.body.vans).filter((id) => resourceExists('van', id));
  tx(() => {
    db.prepare('DELETE FROM assignments WHERE event_date = ? AND event_id = ?').run(date, eventId);
    snapshotJob(date, ev);
    const ins = db.prepare('INSERT INTO assignments (event_id, event_date, resource_type, resource_id) VALUES (?,?,?,?)');
    techs.forEach((id) => ins.run(eventId, date, 'tech', id));
    vans.forEach((id) => ins.run(eventId, date, 'van', id));
    recheckCompleted(date, eventId);
    cleanupJob(date, eventId);
  });
  broadcast('plan-changed', { date });
  res.json({ plans: plansFor(date) });
}));

app.post('/api/complete', requireEditor, wrap(async (req, res) => {
  const { date, eventId, completed } = req.body || {};
  const ev = await requireEvent(date, eventId);
  if (completed && !hasDriver(date, eventId)) {
    throw new HttpError(409, 'No se puede marcar como completo: el grupo no tiene ningún técnico con carnet de conducir (*).', 'NO_DRIVER');
  }
  tx(() => {
    snapshotJob(date, ev);
    db.prepare('UPDATE job_plans SET completed = ?, updated_at = datetime(\'now\') WHERE event_date = ? AND event_id = ?').run(completed ? 1 : 0, date, eventId);
    cleanupJob(date, eventId);
  });
  broadcast('plan-changed', { date });
  res.json({ plans: plansFor(date) });
}));

// Elimina la planificación de un trabajo que ya no está en el calendario ese día.
app.post('/api/orphan/clear', requireEditor, wrap(async (req, res) => {
  const { date, eventId } = req.body || {};
  if (!isValidDate(date) || typeof eventId !== 'string') throw new HttpError(400, 'Datos no válidos');
  tx(() => {
    db.prepare('DELETE FROM assignments WHERE event_date = ? AND event_id = ?').run(date, eventId);
    db.prepare('DELETE FROM job_plans WHERE event_date = ? AND event_id = ?').run(date, eventId);
  });
  broadcast('plan-changed', { date });
  res.json({ plans: plansFor(date) });
}));

// ---------- Configuración de técnicos, furgonetas, perfiles y colores -------------------

const COLOR = /^#[0-9a-fA-F]{6}$/;
const str = (v, max = 60) => String(v ?? '').trim().slice(0, max);

function techFields(b, partial) {
  const f = {};
  if (!partial || 'name' in b) { f.name = str(b.name, 40); if (!f.name) throw new HttpError(400, 'El nombre es obligatorio'); }
  if (!partial || 'area' in b) f.area = ['almacen', 'tecnico'].includes(b.area) ? b.area : 'tecnico';
  if (!partial || 'profile_id' in b) {
    f.profile_id = b.profile_id ? str(b.profile_id) : null;
    if (f.profile_id && !db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(f.profile_id)) throw new HttpError(400, 'Perfil no válido');
  }
  if (!partial || 'has_license' in b) f.has_license = b.has_license ? 1 : 0;
  if ('active' in b) f.active = b.active ? 1 : 0;
  if ('sort' in b && Number.isInteger(b.sort)) f.sort = b.sort;
  return f;
}

function vanFields(b, partial) {
  const f = {};
  if (!partial || 'model' in b) { f.model = str(b.model, 30); if (!f.model) throw new HttpError(400, 'El modelo es obligatorio'); }
  if (!partial || 'plate' in b) { f.plate = str(b.plate, 12).toUpperCase().replace(/\s+/g, ''); if (!f.plate) throw new HttpError(400, 'La matrícula es obligatoria'); }
  if (!partial || 'type_id' in b) {
    f.type_id = b.type_id ? str(b.type_id) : null;
    if (f.type_id && !db.prepare('SELECT 1 FROM van_types WHERE id = ?').get(f.type_id)) throw new HttpError(400, 'Tipo no válido');
  }
  if ('active' in b) f.active = b.active ? 1 : 0;
  if ('sort' in b && Number.isInteger(b.sort)) f.sort = b.sort;
  return f;
}

function update(table, id, f) {
  const keys = Object.keys(f);
  if (!keys.length) return;
  const r = db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), id);
  if (!r.changes) throw new HttpError(404, 'No encontrado');
}

function insert(table, f) {
  const max = db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM ${table}`).get().s;
  const keys = [...Object.keys(f), 'sort'];
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(f), f.sort ?? max);
}

const afterResources = (res) => { broadcast('resources-changed', {}); res.json(resources()); };

app.post('/api/technicians', requireEditor, wrap((req, res) => { insert('technicians', techFields(req.body || {}, false)); afterResources(res); }));
app.put('/api/technicians/:id', requireEditor, wrap((req, res) => { update('technicians', Number(req.params.id), techFields(req.body || {}, true)); afterResources(res); }));
app.post('/api/vans', requireEditor, wrap((req, res) => { insert('vans', vanFields(req.body || {}, false)); afterResources(res); }));
app.put('/api/vans/:id', requireEditor, wrap((req, res) => { update('vans', Number(req.params.id), vanFields(req.body || {}, true)); afterResources(res); }));

function colorFields(b) {
  const f = {};
  if ('name' in b) { f.name = str(b.name, 40); if (!f.name) throw new HttpError(400, 'El nombre es obligatorio'); }
  for (const k of ['color', 'text_color']) {
    if (k in b) { if (!COLOR.test(b[k])) throw new HttpError(400, 'Color no válido'); f[k] = b[k].toUpperCase(); }
  }
  return f;
}
app.put('/api/profiles/:id', requireEditor, wrap((req, res) => { update('profiles', req.params.id, colorFields(req.body || {})); afterResources(res); }));
app.put('/api/van-types/:id', requireEditor, wrap((req, res) => { update('van_types', req.params.id, colorFields(req.body || {})); afterResources(res); }));

// ---------- Conexión con Google (modo OAuth, solo lectura) -------------------------------

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

app.get('/oauth/google/start', (req, res) => {
  const s = readSession(req);
  if (s?.role !== 'editor') return res.status(403).send('Solo un editor puede conectar el calendario.');
  if (config.provider !== 'google' || googleMode() !== 'oauth') return res.status(400).send('El modo OAuth de Google no está configurado.');
  const state = crypto.randomBytes(24).toString('base64url');
  kv.set('oauth_state', JSON.stringify({ state, sid: s.id, exp: Date.now() + 10 * 60_000 }));
  res.redirect(oauthAuthUrl(baseUrl(req), state));
});

app.get('/oauth/google/callback', wrap(async (req, res) => {
  const s = readSession(req);
  const saved = JSON.parse(kv.get('oauth_state') || 'null');
  kv.del('oauth_state');
  if (!s || s.role !== 'editor' || !saved || saved.sid !== s.id || saved.exp < Date.now() || saved.state !== req.query.state) {
    return res.status(400).send('Solicitud de conexión no válida o caducada. Vuelve a intentarlo desde Ajustes.');
  }
  if (req.query.error) return res.redirect('/ajustes?google=denegado');
  try {
    await oauthExchange(baseUrl(req), String(req.query.code || ''));
  } catch (e) {
    console.error('[google oauth]', e.message);
    return res.redirect('/ajustes?google=error&msg=' + encodeURIComponent(e.message));
  }
  getDay(todayIn(config.timeZone), { force: true }).catch(() => {});
  res.redirect('/ajustes?google=ok');
}));

app.post('/api/google/disconnect', requireEditor, (req, res) => { oauthDisconnect(); res.json({ ok: true }); });

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

app.listen(config.port, () => {
  console.log(`Planificación Delaire 2000 en http://localhost:${config.port}  (calendario: ${config.provider || 'SIN CONFIGURAR'}, zona ${config.timeZone})`);
  startPolling();
});
