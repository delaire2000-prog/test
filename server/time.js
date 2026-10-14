// Utilidades de fecha con zona horaria (sin dependencias externas).

const dtfCache = new Map();
function dtf(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return dtfCache.get(tz);
}

/** Desfase (ms) de la zona horaria en el instante dado. */
export function tzOffset(ts, tz) {
  const parts = Object.fromEntries(dtf(tz).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Instante UTC (ms) correspondiente a una hora local "de pared" en la zona dada. */
export function wallTimeToUtc(y, m, d, hh = 0, mm = 0, ss = 0, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let ts = guess - tzOffset(guess, tz);
  ts = guess - tzOffset(ts, tz); // corrige en cambios de horario
  return ts;
}

export function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** [inicio, fin) del día local en ms UTC. */
export function dayBounds(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = wallTimeToUtc(y, m, d, 0, 0, 0, tz);
  const [y2, m2, d2] = addDays(dateStr, 1).split('-').map(Number);
  const end = wallTimeToUtc(y2, m2, d2, 0, 0, 0, tz);
  return { start, end };
}

/** Fecha local (YYYY-MM-DD) de "ahora" en la zona dada. */
export function todayIn(tz, now = Date.now()) {
  return new Date(now + tzOffset(now, tz)).toISOString().slice(0, 10);
}

/** Convierte "2026-10-06T09:30:00.0000000" (hora local en tz) a ms UTC. */
export function localIsoToUtc(s, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return NaN;
  return wallTimeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz);
}
