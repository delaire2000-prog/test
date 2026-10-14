// Proveedor Google Calendar — SOLO LECTURA.
// Ámbito OAuth único solicitado: calendar.events.readonly (leer eventos; nada más).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { kv } from '../db.js';
import { seal, open } from '../secretbox.js';
import { getJson, postToken, htmlToText, CalendarError } from './http.js';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REFRESH_KEY = 'google_refresh_token';

let cached = { token: null, exp: 0 };

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function serviceAccount() {
  if (!config.google.serviceAccountFile) return null;
  try {
    const sa = JSON.parse(fs.readFileSync(config.google.serviceAccountFile, 'utf8'));
    if (!sa.client_email || !sa.private_key) throw new Error('faltan client_email/private_key');
    return sa;
  } catch (e) {
    throw new CalendarError(`No se pudo leer la cuenta de servicio (${config.google.serviceAccountFile}): ${e.message}`);
  }
}

export function googleMode() {
  if (config.google.serviceAccountFile) return 'service_account';
  if (config.google.oauthClientId && config.google.oauthClientSecret) return 'oauth';
  return null;
}

export function googleStatus() {
  const mode = googleMode();
  return {
    mode,
    calendarId: config.google.calendarId,
    oauthConnected: mode === 'oauth' ? !!kv.get(REFRESH_KEY) : undefined,
    scope: GOOGLE_SCOPE,
  };
}

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const mode = googleMode();
  let body;
  if (mode === 'service_account') {
    const sa = serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const c = { iss: sa.client_email, scope: GOOGLE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
    // Opcional (Google Workspace): delegación de dominio limitada al ámbito de solo lectura.
    if (config.google.impersonateUser) c.sub = config.google.impersonateUser;
    const claims = b64url(JSON.stringify(c));
    const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key));
    body = await postToken(TOKEN_URL, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${sig}` });
  } else if (mode === 'oauth') {
    const sealed = kv.get(REFRESH_KEY);
    const refresh = sealed && open(sealed);
    if (!refresh) throw new CalendarError('Google no está conectado todavía. Un editor debe pulsar «Conectar Google Calendar» en Ajustes.', { code: 'NOT_CONNECTED' });
    body = await postToken(TOKEN_URL, {
      grant_type: 'refresh_token', refresh_token: refresh,
      client_id: config.google.oauthClientId, client_secret: config.google.oauthClientSecret,
    });
  } else {
    throw new CalendarError('Google Calendar no está configurado (faltan credenciales en el servidor).', { code: 'NOT_CONFIGURED' });
  }
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 };
  return cached.token;
}

// ---- Flujo OAuth (solo modo "oauth") ---------------------------------------------------

export function oauthRedirectUri(baseUrl) {
  return `${baseUrl}/oauth/google/callback`;
}

export function oauthAuthUrl(baseUrl, state) {
  const p = new URLSearchParams({
    client_id: config.google.oauthClientId,
    redirect_uri: oauthRedirectUri(baseUrl),
    response_type: 'code',
    scope: GOOGLE_SCOPE, // único permiso: leer eventos
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    login_hint: config.google.loginHint,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function oauthExchange(baseUrl, code) {
  const body = await postToken(TOKEN_URL, {
    grant_type: 'authorization_code', code,
    client_id: config.google.oauthClientId, client_secret: config.google.oauthClientSecret,
    redirect_uri: oauthRedirectUri(baseUrl),
  });
  const granted = String(body.scope || '').split(' ').filter(Boolean);
  // Rechaza cualquier concesión que no sea exactamente de solo lectura.
  const extra = granted.filter((s) => s !== GOOGLE_SCOPE);
  if (!granted.includes(GOOGLE_SCOPE) || extra.length) {
    throw new CalendarError(`Permisos concedidos inesperados (${granted.join(', ') || 'ninguno'}). Solo se acepta ${GOOGLE_SCOPE}.`);
  }
  if (!body.refresh_token) throw new CalendarError('Google no devolvió un refresh token. Revoca el acceso en tu cuenta de Google y vuelve a conectar.');
  kv.set(REFRESH_KEY, seal(body.refresh_token));
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 };
}

export function oauthDisconnect() {
  kv.del(REFRESH_KEY);
  cached = { token: null, exp: 0 };
}

// ---- Lectura de eventos ----------------------------------------------------------------

function normalize(e) {
  const allDay = !!e.start?.date;
  return {
    id: e.id,
    title: (e.summary || '').trim() || '(Sin título)',
    description: htmlToText(e.description),
    location: e.location || '',
    allDay,
    start: allDay ? null : Date.parse(e.start?.dateTime),
    end: allDay ? null : Date.parse(e.end?.dateTime),
    startDate: allDay ? e.start.date : null,
    endDate: allDay ? e.end?.date : null, // exclusiva
    status: e.status || 'confirmed',
    link: e.htmlLink || '',
    organizer: e.organizer?.displayName || e.organizer?.email || '',
    attendees: (e.attendees || []).filter((a) => !a.resource).map((a) => a.displayName || a.email),
    categories: [],
    colorId: e.colorId || null,
    recurring: !!e.recurringEventId,
    updated: e.updated || null,
    created: e.created || null,
    source: 'google',
  };
}

export async function listGoogleEvents(timeMinMs, timeMaxMs) {
  const token = await accessToken();
  const out = [];
  let pageToken;
  do {
    const p = new URLSearchParams({
      timeMin: new Date(timeMinMs).toISOString(),
      timeMax: new Date(timeMaxMs).toISOString(),
      singleEvents: 'true', // cada repetición de un evento periódico tiene su propio id
      orderBy: 'startTime',
      maxResults: '2500',
      timeZone: config.timeZone,
    });
    if (pageToken) p.set('pageToken', pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.google.calendarId)}/events?${p}`;
    const body = await getJson(url, token);
    for (const e of body.items || []) if (e.status !== 'cancelled') out.push(normalize(e));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}
