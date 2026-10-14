// Almacenamiento de la planificación interna (SQLite en el servidor, fuera de Google Calendar).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { PROFILES, TECHNICIANS, VAN_TYPES, VANS } from './seed.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const file = path.join(config.dataDir, config.provider === 'demo' ? 'planificacion-demo.sqlite' : 'planificacion.sqlite');
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, text_color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'tecnico',
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  has_license INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS van_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, text_color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  plate TEXT NOT NULL,
  type_id TEXT REFERENCES van_types(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
-- Asignaciones: clave = identificador del evento + fecha del día planificado.
CREATE TABLE IF NOT EXISTS assignments (
  event_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('tech','van')),
  resource_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, event_date, resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_date ON assignments(event_date);
-- Estado interno del trabajo + copia mínima del evento (para detectar trabajos movidos/borrados).
CREATE TABLE IF NOT EXISTS job_plans (
  event_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  event_title TEXT,
  event_start TEXT,
  event_end TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, event_date)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

function seed() {
  const has = db.prepare('SELECT value FROM kv WHERE key = ?').get('seeded');
  if (has) return;
  tx(() => {
    const p = db.prepare('INSERT OR IGNORE INTO profiles (id,name,color,text_color,sort) VALUES (?,?,?,?,?)');
    PROFILES.forEach((x) => p.run(x.id, x.name, x.color, x.text_color, x.sort));
    const t = db.prepare('INSERT INTO technicians (name,area,profile_id,has_license,sort) VALUES (?,?,?,?,?)');
    TECHNICIANS.forEach((x, i) => t.run(x.name, x.area, x.profile_id, x.has_license, i + 1));
    const vt = db.prepare('INSERT OR IGNORE INTO van_types (id,name,color,text_color,sort) VALUES (?,?,?,?,?)');
    VAN_TYPES.forEach((x) => vt.run(x.id, x.name, x.color, x.text_color, x.sort));
    const v = db.prepare('INSERT INTO vans (model,plate,type_id,sort) VALUES (?,?,?,?)');
    VANS.forEach((x, i) => v.run(x.model, x.plate, x.type_id, i + 1));
    db.prepare('INSERT INTO kv (key,value) VALUES (?,?)').run('seeded', new Date().toISOString());
  });
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const kv = {
  get: (k) => db.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? null,
  set: (k, v) => db.prepare('INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v),
  del: (k) => db.prepare('DELETE FROM kv WHERE key = ?').run(k),
};

seed();
