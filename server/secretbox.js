// Cifrado simétrico (AES-256-GCM) para guardar tokens en la base de datos del servidor.
import crypto from 'node:crypto';
import { config } from './config.js';

const key = () => crypto.createHash('sha256').update('d2k-secretbox:' + config.auth.sessionSecret).digest();

export function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function open(sealed) {
  try {
    const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
