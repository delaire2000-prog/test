// Configuración leída exclusivamente de variables de entorno (fichero .env en el servidor).
// Ningún secreto se envía nunca al navegador.
import path from 'node:path';

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(env.PORT, 3000),
  timeZone: env.TZ_CALENDARIO || 'Europe/Madrid',
  dataDir: path.resolve(env.DATA_DIR || 'data'),
  // google | microsoft | demo | (vacío = sin configurar)
  provider: (env.CALENDAR_PROVIDER || '').toLowerCase(),
  syncIntervalSeconds: Math.max(30, num(env.SYNC_INTERVAL_SECONDS, 60)),
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),

  auth: {
    editorPassword: env.APP_PASSWORD || '',
    viewerPassword: env.DISPLAY_PASSWORD || '',
    displayToken: env.DISPLAY_TOKEN || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionDays: num(env.SESSION_DAYS, 30),
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
  },

  google: {
    calendarId: env.GOOGLE_CALENDAR_ID || 'info@delaire-2000.com',
    serviceAccountFile: env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
    impersonateUser: env.GOOGLE_IMPERSONATE_USER || '',
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID || '',
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    loginHint: env.GOOGLE_LOGIN_HINT || 'info@delaire-2000.com',
  },

  microsoft: {
    tenantId: env.MS_TENANT_ID || '',
    clientId: env.MS_CLIENT_ID || '',
    clientSecret: env.MS_CLIENT_SECRET || '',
    calendarUser: env.MS_CALENDAR_USER || 'info@delaire-2000.com',
  },
};

export function validateConfig() {
  const errors = [];
  if (!config.auth.editorPassword || config.auth.editorPassword.length < 10) {
    errors.push('APP_PASSWORD es obligatoria y debe tener al menos 10 caracteres.');
  }
  if (!config.auth.sessionSecret || config.auth.sessionSecret.length < 32) {
    errors.push('SESSION_SECRET es obligatoria (mínimo 32 caracteres aleatorios).');
  }
  if (config.auth.displayToken && config.auth.displayToken.length < 24) {
    errors.push('DISPLAY_TOKEN debe tener al menos 24 caracteres si se usa.');
  }
  return errors;
}
