// Cliente HTTP de SOLO LECTURA para las APIs de calendario.
// Única función expuesta para el calendario: getJson (método GET). No existe en el código
// ninguna llamada POST/PUT/PATCH/DELETE contra Google Calendar ni Microsoft Graph.
// (Las únicas peticiones POST salen hacia los servidores de tokens OAuth para obtener
// un token de acceso de solo lectura.)

const ALLOWED_READ_HOSTS = new Set(['www.googleapis.com', 'graph.microsoft.com']);

export class CalendarError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getJson(url, token, extraHeaders = {}) {
  const u = new URL(url);
  if (!ALLOWED_READ_HOSTS.has(u.host)) throw new CalendarError(`Host no permitido: ${u.host}`);
  const res = await fetch(u, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error_description || body?.raw || res.statusText;
    throw new CalendarError(`Error ${res.status} del calendario: ${msg}`, { status: res.status, code: body?.error?.code });
  }
  return body;
}

/** Petición al servidor de tokens OAuth (no al calendario). */
export async function postToken(url, params) {
  const u = new URL(url);
  if (!['oauth2.googleapis.com', 'login.microsoftonline.com'].includes(u.host)) {
    throw new CalendarError(`Servidor de tokens no permitido: ${u.host}`);
  }
  const res = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new CalendarError(`No se pudo obtener el token: ${body.error_description || body.error || res.status}`, { status: res.status, code: body.error });
  }
  return body;
}

/** Convierte descripciones HTML del calendario en texto plano seguro. */
export function htmlToText(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
