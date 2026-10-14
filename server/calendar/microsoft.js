// Proveedor Microsoft 365 / Outlook — SOLO LECTURA (alternativa por si el calendario
// info@ está alojado en Microsoft 365). Permiso de aplicación único: Calendars.Read.
import { config } from '../config.js';
import { getJson, postToken, htmlToText, CalendarError } from './http.js';
import { localIsoToUtc } from '../time.js';

let cached = { token: null, exp: 0 };

export function microsoftStatus() {
  const m = config.microsoft;
  return { configured: !!(m.tenantId && m.clientId && m.clientSecret), calendarUser: m.calendarUser, permission: 'Calendars.Read' };
}

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const m = config.microsoft;
  if (!m.tenantId || !m.clientId || !m.clientSecret) {
    throw new CalendarError('Microsoft 365 no está configurado (faltan MS_TENANT_ID, MS_CLIENT_ID o MS_CLIENT_SECRET).', { code: 'NOT_CONFIGURED' });
  }
  const body = await postToken(`https://login.microsoftonline.com/${encodeURIComponent(m.tenantId)}/oauth2/v2.0/token`, {
    grant_type: 'client_credentials', client_id: m.clientId, client_secret: m.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });
  cached = { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 };
  return cached.token;
}

function normalize(e) {
  const tz = config.timeZone;
  const allDay = !!e.isAllDay;
  return {
    id: e.id,
    title: (e.subject || '').trim() || '(Sin título)',
    description: e.body?.contentType === 'html' ? htmlToText(e.body?.content) : (e.body?.content || '').trim(),
    location: e.location?.displayName || '',
    allDay,
    start: allDay ? null : localIsoToUtc(e.start?.dateTime, tz),
    end: allDay ? null : localIsoToUtc(e.end?.dateTime, tz),
    startDate: allDay ? e.start?.dateTime?.slice(0, 10) : null,
    endDate: allDay ? e.end?.dateTime?.slice(0, 10) : null,
    status: e.isCancelled ? 'cancelled' : 'confirmed',
    link: e.webLink || '',
    organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || '',
    attendees: (e.attendees || []).map((a) => a.emailAddress?.name || a.emailAddress?.address).filter(Boolean),
    categories: e.categories || [],
    colorId: null,
    recurring: !!e.seriesMasterId,
    updated: e.lastModifiedDateTime || null,
    created: e.createdDateTime || null,
    source: 'microsoft',
  };
}

export async function listMicrosoftEvents(timeMinMs, timeMaxMs) {
  const token = await accessToken();
  const p = new URLSearchParams({
    startDateTime: new Date(timeMinMs).toISOString(),
    endDateTime: new Date(timeMaxMs).toISOString(),
    $top: '500',
    $select: 'id,subject,body,start,end,isAllDay,location,categories,webLink,isCancelled,organizer,attendees,seriesMasterId,lastModifiedDateTime,createdDateTime',
  });
  let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.microsoft.calendarUser)}/calendarView?${p}`;
  const headers = { Prefer: `outlook.timezone="${config.timeZone}", outlook.body-content-type="text"` };
  const out = [];
  while (url) {
    const body = await getJson(url, token, headers);
    for (const e of body.value || []) if (!e.isCancelled) out.push(normalize(e));
    url = body['@odata.nextLink'] || null;
  }
  return out;
}
