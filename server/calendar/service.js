// Servicio de sincronización: lee eventos del proveedor (solo lectura), los cachea por día,
// los refresca periódicamente y avisa a los clientes cuando cambian.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { dayBounds, todayIn, isValidDate } from '../time.js';
import { listGoogleEvents, googleStatus, googleMode } from './google.js';
import { listMicrosoftEvents, microsoftStatus } from './microsoft.js';
import { listDemoEvents } from './demo.js';
import { CalendarError } from './http.js';

export const calendarEvents = new EventEmitter();
calendarEvents.setMaxListeners(0);

const cache = new Map(); // date -> { events, syncedAt, hash, error }
const inflight = new Map();
const watched = new Map(); // date -> último acceso (ms)
const WATCH_MS = 20 * 60_000;
let lastError = null;
let lastSuccessAt = null;

function lister() {
  switch (config.provider) {
    case 'google': return listGoogleEvents;
    case 'microsoft': return listMicrosoftEvents;
    case 'demo': return listDemoEvents;
    default: return null;
  }
}

export function providerStatus() {
  const base = { provider: config.provider || null, timeZone: config.timeZone, syncIntervalSeconds: config.syncIntervalSeconds, lastSuccessAt, lastError };
  if (config.provider === 'google') return { ...base, google: googleStatus(), configured: !!googleMode() };
  if (config.provider === 'microsoft') return { ...base, microsoft: microsoftStatus(), configured: microsoftStatus().configured };
  if (config.provider === 'demo') return { ...base, configured: true, demo: true };
  return { ...base, configured: false };
}

/** Intervalo efectivo [start,end) del evento dentro del día consultado (ms UTC). */
function spanInDay(e, bounds) {
  if (e.allDay) return { start: bounds.start, end: bounds.end };
  return { start: Math.max(e.start, bounds.start), end: Math.min(e.end, bounds.end) };
}

function sortEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0) || a.title.localeCompare(b.title, 'es');
}

async function fetchDay(date) {
  const list = lister();
  if (!list) throw new CalendarError('No hay ningún calendario configurado en el servidor (CALENDAR_PROVIDER).', { code: 'NOT_CONFIGURED' });
  const bounds = dayBounds(date, config.timeZone);
  const raw = await list(bounds.start, bounds.end);
  const events = raw
    .filter((e) => (e.allDay
      ? e.startDate <= date && date < (e.endDate && e.endDate > e.startDate ? e.endDate : addOne(e.startDate))
      : e.end > bounds.start && e.start < bounds.end))
    .map((e) => {
      const span = spanInDay(e, bounds);
      return { ...e, multiDay: e.allDay ? (e.endDate > addOne(e.startDate)) : (e.start < bounds.start || e.end > bounds.end), span };
    })
    .sort(sortEvents);
  return events;
}

function addOne(d) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10);
}

function hashEvents(events) {
  return crypto.createHash('sha1').update(JSON.stringify(events)).digest('hex');
}

/**
 * Devuelve los eventos de un día. Usa la caché salvo que esté caducada o se fuerce.
 * Si el proveedor falla y hay caché, devuelve la caché marcada con el error.
 */
export async function getDay(date, { force = false, touch = true } = {}) {
  if (!isValidDate(date)) throw new CalendarError('Fecha no válida');
  if (touch) watched.set(date, Date.now());
  const c = cache.get(date);
  const fresh = c && !c.error && Date.now() - c.syncedAt < config.syncIntervalSeconds * 1000;
  if (fresh && !force) return c;
  if (inflight.has(date)) return inflight.get(date);
  const p = (async () => {
    try {
      const events = await fetchDay(date);
      const hash = hashEvents(events);
      const entry = { events, syncedAt: Date.now(), hash, error: null };
      const changed = c && c.hash !== hash;
      cache.set(date, entry);
      lastSuccessAt = entry.syncedAt;
      lastError = null;
      if (changed) calendarEvents.emit('day-changed', { date });
      return entry;
    } catch (e) {
      lastError = { message: e.message, code: e.code || null, at: Date.now() };
      console.error(`[calendario] ${date}: ${e.message}`);
      if (c) {
        const entry = { ...c, error: lastError };
        cache.set(date, entry);
        return entry;
      }
      return { events: [], syncedAt: null, hash: null, error: lastError };
    } finally {
      inflight.delete(date);
    }
  })();
  inflight.set(date, p);
  return p;
}

/** Devuelve el evento cacheado (para validar asignaciones). */
export function findCachedEvent(date, eventId) {
  return cache.get(date)?.events.find((e) => e.id === eventId) || null;
}

// Sondeo periódico: hoy, mañana y los días consultados recientemente.
let timer = null;
export function startPolling() {
  if (!lister() || timer) return;
  const tick = async () => {
    const now = Date.now();
    const today = todayIn(config.timeZone);
    const dates = new Set([today, addOne(today)]);
    for (const [d, at] of watched) {
      if (now - at < WATCH_MS) dates.add(d);
      else { watched.delete(d); if (!dates.has(d)) cache.delete(d); }
    }
    for (const d of dates) {
      await getDay(d, { force: true, touch: false }).catch(() => {});
    }
  };
  tick();
  timer = setInterval(tick, config.syncIntervalSeconds * 1000);
  timer.unref?.();
}
