// Reglas de planificación compartidas entre servidor y navegador (sin dependencias del DOM).
// Solo trabajan sobre la planificación interna; nunca modifican el calendario.

export function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function overlaps(a, b) {
  return a.span.start < b.span.end && b.span.start < a.span.end;
}

/** Otros trabajos del día, solapados con `eventId`, en los que ya está el recurso. */
export function conflictsFor(type, resourceId, eventId, events, plans) {
  const target = events.find((e) => e.id === eventId);
  if (!target) return [];
  const key = type === 'tech' ? 'techs' : 'vans';
  return events.filter((e) => e.id !== eventId && plans[e.id]?.[key]?.includes(resourceId) && overlaps(e, target));
}

/** Técnicos con posible ausencia según eventos tipo "VACACIONES X", "AUSENCIA X"... */
export function detectAbsences(events, techs) {
  const out = {}; // techId -> [eventId]
  const byLen = [...techs].sort((a, b) => b.name.length - a.name.length);
  for (const e of events) {
    let t = norm(e.title);
    if (!/\b(VACACIONES|AUSENCIA|BAJA|MEDICO|PERMISO|DIA LIBRE|ASUNTOS PROPIOS)\b/.test(t)) continue;
    for (const tech of byLen) {
      const re = new RegExp(`\\b${escRe(norm(tech.name))}\\w*\\b`);
      if (re.test(t)) {
        (out[tech.id] ||= []).push(e.id);
        t = t.replace(re, ' ');
      }
    }
  }
  return out;
}

/**
 * Sugerencias leídas del TÍTULO del evento (p. ej. "... | EDDY + JOSE | TRAFIC 0824NLL").
 * Solo se proponen; nunca se aplican automáticamente.
 */
export function titleHints(title, techs, vans) {
  const tNorm = norm(title);
  const techIds = new Set();
  const names = techs.map((t) => ({ id: t.id, n: norm(t.name), multi: norm(t.name).includes(' ') }));
  for (const seg of tNorm.split('|')) {
    const tokens = seg.split(/\s*(?:\+|,|\/|&|\bY\b)\s*/).map((x) => x.trim()).filter(Boolean);
    if (!tokens.length) continue;
    const ids = [];
    let all = true;
    for (const tok of tokens) {
      const exact = names.find((n) => n.n === tok);
      const pref = exact || names.find((n) => n.multi && tok.startsWith(n.n));
      if (pref) ids.push(pref.id); else { all = false; break; }
    }
    if (all) ids.forEach((id) => techIds.add(id));
  }
  const compact = tNorm.replace(/[\s-]/g, '');
  const vanIds = vans.filter((v) => v.plate && compact.includes(norm(v.plate).replace(/[\s-]/g, ''))).map((v) => v.id);
  return { techs: [...techIds], vans: vanIds };
}

/**
 * Calcula el estado de cada trabajo del día.
 * plans: { [eventId]: { techs:[id], vans:[id], completed:bool } }
 */
export function computeDay(events, plans, techs, vans) {
  const techById = Object.fromEntries(techs.map((t) => [t.id, t]));
  const absences = detectAbsences(events, techs);
  const use = { tech: {}, van: {} };
  for (const e of events) {
    const p = plans[e.id];
    if (!p) continue;
    p.techs.forEach((id) => (use.tech[id] ||= []).push(e.id));
    p.vans.forEach((id) => (use.van[id] ||= []).push(e.id));
  }
  const jobs = {};
  for (const e of events) {
    const p = plans[e.id] || { techs: [], vans: [], completed: false };
    const conflicts = [];
    for (const [type, key] of [['tech', 'techs'], ['van', 'vans']]) {
      for (const id of p[key]) {
        const others = conflictsFor(type, id, e.id, events, plans).map((o) => o.id);
        if (others.length) conflicts.push({ type, id, with: others });
      }
    }
    const hasDriver = p.techs.some((id) => techById[id]?.has_license);
    const absent = p.techs.filter((id) => absences[id] && !absences[id].includes(e.id));
    const status = [];
    if (!p.techs.length) status.push('sin-asignar');
    else if (!hasDriver) status.push('sin-conductor');
    else status.push('asignado');
    if (conflicts.length) status.push('conflicto');
    if (absent.length) status.push('ausencia');
    if (p.completed) status.push('completo');
    jobs[e.id] = { techs: p.techs, vans: p.vans, completed: !!p.completed, hasDriver, conflicts, absent, status };
  }
  const summary = {
    total: events.length,
    sinAsignar: Object.values(jobs).filter((j) => j.status.includes('sin-asignar')).length,
    sinConductor: Object.values(jobs).filter((j) => j.status.includes('sin-conductor')).length,
    conflictos: Object.values(jobs).filter((j) => j.status.includes('conflicto')).length,
    completos: Object.values(jobs).filter((j) => j.completed).length,
  };
  return { jobs, use, absences, summary };
}
