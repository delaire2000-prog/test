import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDay, titleHints, detectAbsences, conflictsFor } from '../public/shared/planning.js';
import { dayBounds, localIsoToUtc, todayIn } from '../server/time.js';

const techs = [
  { id: 1, name: 'Eddy', has_license: true }, { id: 2, name: 'Jose', has_license: false },
  { id: 3, name: 'Jose Alm', has_license: true }, { id: 4, name: 'Juan', has_license: true },
  { id: 5, name: 'Alexis', has_license: false },
];
const vans = [{ id: 10, model: 'Trafic', plate: '0824NLL' }, { id: 11, model: 'Mercedes', plate: '0715JGW' }];
const ev = (id, s, e, title = id) => ({ id, title, span: { start: s, end: e } });

test('conflictos de horario por técnico y furgoneta', () => {
  const events = [ev('a', 0, 10), ev('b', 5, 15), ev('c', 15, 20)];
  const plans = { a: { techs: [1], vans: [10], completed: false }, b: { techs: [1, 2], vans: [10], completed: false }, c: { techs: [1], vans: [], completed: false } };
  const r = computeDay(events, plans, techs, vans);
  assert.ok(r.jobs.a.status.includes('conflicto'));
  assert.deepEqual(r.jobs.a.conflicts.map((c) => c.type).sort(), ['tech', 'van']);
  assert.ok(!r.jobs.c.status.includes('conflicto'), 'tramos contiguos no se solapan');
  assert.equal(conflictsFor('tech', 1, 'c', events, plans).length, 0);
});

test('grupo sin conductor y grupos de distinto tamaño', () => {
  const events = [ev('a', 0, 10), ev('b', 20, 30), ev('c', 40, 50)];
  const plans = { a: { techs: [2, 5], vans: [], completed: false }, b: { techs: [2, 5, 1], vans: [], completed: false } };
  const r = computeDay(events, plans, techs, vans);
  assert.deepEqual(r.jobs.a.status, ['sin-conductor']);
  assert.deepEqual(r.jobs.b.status, ['asignado']);
  assert.deepEqual(r.jobs.c.status, ['sin-asignar']);
  assert.equal(r.summary.sinConductor, 1);
});

test('sugerencias leídas del título', () => {
  const h = titleHints('OK-SPLIT 1X1 | MITSUBISHI - MSZ-HR42VF | FRANCISCO JAVIER | EDDY + JOSE | TRAFIC 0824NLL', techs, vans);
  assert.deepEqual(h.techs.sort(), [1, 2]);
  assert.deepEqual(h.vans, [10]);
  const h2 = titleHints('SPLIT | JUAN ECHEVARRIA BUADES', techs, vans);
  assert.deepEqual(h2.techs, [], 'un nombre de cliente no es un técnico');
  const h3 = titleHints('100MONTADITOS | JUAN + ANDRES + ALEXIS | MERCEDES 0715JGW + MERCEDES 5020JKD', techs, vans);
  assert.deepEqual(h3.vans, [11]);
});

test('ausencias: JOSE ALMACÉN no marca a Jose', () => {
  const a = detectAbsences([{ id: 'x', title: 'VACACIONES JOSE ALMACÉN' }, { id: 'y', title: 'AUSENCIA ALEXIS POR MÉDICO' }], techs);
  assert.deepEqual(Object.keys(a).map(Number).sort(), [3, 5]);
});

test('zona horaria Europe/Madrid (incluido cambio de hora)', () => {
  const b = dayBounds('2026-10-25', 'Europe/Madrid'); // día de 25 h
  assert.equal(new Date(b.start).toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(new Date(b.end).toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(new Date(localIsoToUtc('2026-10-06T09:30:00.0000000', 'Europe/Madrid')).toISOString(), '2026-10-06T07:30:00.000Z');
  assert.equal(todayIn('Europe/Madrid', Date.parse('2026-10-13T22:30:00Z')), '2026-10-14');
});
