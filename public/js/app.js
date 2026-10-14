// Planificación diaria Delaire 2000 — interfaz.
// Todo lo que se edita aquí es planificación INTERNA; el calendario solo se lee.
import { computeDay, conflictsFor, titleHints } from '/shared/planning.js';
import { initDragAndDrop } from './dnd.js';

// ---------- Utilidades ------------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (s, r = document) => r.querySelector(s);

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-D2K': '1' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Sesión caducada'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Error ${res.status}`); e.code = data.code; throw e; }
  return data;
}

// ---------- Estado ----------------------------------------------------------------------

const state = {
  role: 'viewer', tz: 'Europe/Madrid', today: null, date: null, view: 'board',
  res: { profiles: [], techs: [], vanTypes: [], vans: [] },
  day: { events: [], plans: {}, orphans: [], syncedAt: null, error: null, status: {} },
  calc: null, selected: null, loading: false,
};
const isEditor = () => state.role === 'editor';
const techById = (id) => state.res.techs.find((t) => t.id === id);
const vanById = (id) => state.res.vans.find((v) => v.id === id);
const profileById = (id) => state.res.profiles.find((p) => p.id === id);
const vanTypeById = (id) => state.res.vanTypes.find((p) => p.id === id);
const eventById = (id) => state.day.events.find((e) => e.id === id);
const planOf = (id) => state.day.plans[id] || { techs: [], vans: [], completed: false };

// ---------- Formato ---------------------------------------------------------------------

let fmtTime, fmtDateLong, fmtDateShort, fmtDateTime;
function initFormats() {
  const tz = state.tz;
  fmtTime = new Intl.DateTimeFormat('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  fmtDateLong = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  fmtDateShort = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  fmtDateTime = new Intl.DateTimeFormat('es-ES', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const dateObj = (d) => new Date(`${d}T12:00:00Z`);
const longDate = (d) => { const s = fmtDateLong.format(dateObj(d)); return s[0].toUpperCase() + s.slice(1); };
const addDays = (d, n) => { const x = dateObj(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function timeLabel(e) {
  if (e.allDay) return e.multiDay ? 'Todo el día · varios días' : 'Todo el día';
  const s = fmtTime.format(e.start), f = fmtTime.format(e.end);
  const startsBefore = e.span.start > e.start, endsAfter = e.span.end < e.end;
  return `${startsBefore ? '← ' : ''}${s} – ${f}${endsAfter ? ' →' : ''}`;
}
function shortTime(e) { return e.allDay ? 'Todo el día' : `${fmtTime.format(e.start)}–${fmtTime.format(e.end)}`; }
function relTime(ms) {
  if (!ms) return 'nunca';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return 'ahora mismo';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return fmtDateTime.format(ms);
}
const mapsUrl = (loc) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;

// ---------- Colores y fichas -------------------------------------------------------------

function techStyle(t) {
  const p = t.profile_id && profileById(t.profile_id);
  return p ? { bg: p.color, fg: p.text_color, label: p.name, pending: false }
    : { bg: '#FFFFFF', fg: '#111111', label: 'Perfil/color pendiente de confirmar', pending: true };
}
function vanStyle(v) {
  const t = v.type_id && vanTypeById(v.type_id);
  return t ? { bg: t.color, fg: t.text_color, label: t.name, pending: false }
    : { bg: '#FFFFFF', fg: '#111111', label: 'Tipo pendiente de confirmar', pending: true };
}
const techLabel = (t) => `${t.has_license ? '*' : ''}${t.name.toUpperCase()}`;
const vanLabel = (v) => `${v.model.toUpperCase()} ${v.plate}`;

function techChip(t, { from = '', removable = false, count = 0, big = false } = {}) {
  const st = techStyle(t);
  const absent = state.calc?.absences?.[t.id];
  const title = [
    t.name, st.label, t.has_license ? 'Con carnet de conducir (*)' : 'Sin carnet de conducir',
    absent ? 'Posible ausencia hoy según el calendario' : '', !t.active ? 'Inactivo' : '',
  ].filter(Boolean).join(' · ');
  const sel = state.selected && state.selected.type === 'tech' && state.selected.id === t.id && !from;
  return h('span', {
    class: `chip chip-tech${st.pending ? ' pending' : ''}${absent ? ' absent' : ''}${sel ? ' selected' : ''}${big ? ' big' : ''}${!t.active ? ' inactive' : ''}`,
    style: { '--chip-bg': st.bg, '--chip-fg': st.fg },
    title, role: from || !isEditor() ? null : 'button', tabindex: !from && isEditor() ? '0' : null,
    'aria-pressed': !from && isEditor() ? String(!!sel) : null,
    dataset: isEditor() && from !== '-' ? { drag: 'tech', id: String(t.id), from } : {},
    onclick: !from && isEditor() ? () => toggleSelect('tech', t.id) : null,
    onkeydown: !from && isEditor() ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect('tech', t.id); } } : null,
  },
  h('span', { class: 'chip-label' }, techLabel(t)),
  st.pending ? h('span', { class: 'chip-flag', title: 'Perfil/color pendiente de confirmar', 'aria-label': 'pendiente de confirmar' }, '?') : null,
  absent ? h('span', { class: 'chip-flag warn', 'aria-label': 'posible ausencia' }, '!') : null,
  count ? h('span', { class: 'chip-count', 'aria-label': `${count} trabajos` }, String(count)) : null,
  removable && isEditor() ? h('button', { class: 'chip-x', type: 'button', 'aria-label': `Quitar a ${t.name}`, title: `Quitar a ${t.name}`, onclick: (e) => { e.stopPropagation(); unassign('tech', t.id, from); } }, '×') : null);
}

function vanChip(v, { from = '', removable = false, count = 0, big = false } = {}) {
  const st = vanStyle(v);
  const sel = state.selected && state.selected.type === 'van' && state.selected.id === v.id && !from;
  return h('span', {
    class: `chip chip-van${st.pending ? ' pending' : ''}${sel ? ' selected' : ''}${big ? ' big' : ''}${!v.active ? ' inactive' : ''}`,
    style: { '--chip-bg': st.bg, '--chip-fg': st.fg },
    title: `${vanLabel(v)} · Furgoneta ${st.label.toLowerCase()}`,
    role: from || !isEditor() ? null : 'button', tabindex: !from && isEditor() ? '0' : null,
    'aria-pressed': !from && isEditor() ? String(!!sel) : null,
    dataset: isEditor() && from !== '-' ? { drag: 'van', id: String(v.id), from } : {},
    onclick: !from && isEditor() ? () => toggleSelect('van', v.id) : null,
    onkeydown: !from && isEditor() ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect('van', v.id); } } : null,
  },
  h('span', { class: 'chip-label' }, vanLabel(v)),
  h('span', { class: 'chip-type' }, st.label),
  count ? h('span', { class: 'chip-count' }, String(count)) : null,
  removable && isEditor() ? h('button', { class: 'chip-x', type: 'button', 'aria-label': `Quitar ${vanLabel(v)}`, title: 'Quitar furgoneta', onclick: (e) => { e.stopPropagation(); unassign('van', v.id, from); } }, '×') : null);
}

const STATUS = {
  'sin-asignar': { text: 'Sin asignar', cls: 'st-unassigned' },
  'sin-conductor': { text: 'Sin conductor', cls: 'st-nodriver' },
  asignado: { text: 'Asignado', cls: 'st-assigned' },
  conflicto: { text: 'Conflicto de horario', cls: 'st-conflict' },
  ausencia: { text: 'Posible ausencia', cls: 'st-absence' },
  completo: { text: 'Grupo completo', cls: 'st-complete' },
};
const badge = (s) => h('span', { class: `badge ${STATUS[s].cls}` }, STATUS[s].text);

// ---------- Avisos / confirmaciones -----------------------------------------------------

let toastTimer;
function toast(msg, { kind = 'info', action } = {}) {
  const t = $('#toast');
  t.replaceChildren(...[h('span', {}, msg), action && h('button', { type: 'button', onclick: () => { t.hidden = true; action.fn(); } }, action.label)].filter(Boolean));
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 7000 : 4000);
}

function confirmDialog({ title, lines, ok = 'Continuar', cancel = 'Cancelar', danger = false, alertOnly = false }) {
  return new Promise((resolve) => {
    const d = $('#dlg-confirm');
    d.replaceChildren(h('form', { method: 'dialog', class: 'dlg-body' },
      h('h2', {}, title),
      ...lines.map((l) => h('p', {}, l)),
      h('div', { class: 'dlg-actions' },
        alertOnly ? null : h('button', { value: 'cancel', class: 'btn' }, cancel),
        h('button', { value: 'ok', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, autofocus: true }, alertOnly ? 'Entendido' : ok))));
    d.onclose = () => resolve(d.returnValue === 'ok' && !alertOnly);
    d.returnValue = '';
    d.showModal();
  });
}

// ---------- Acciones de planificación ----------------------------------------------------

function applyPlans(plans) {
  state.day.plans = plans;
  recompute();
  render();
}

function wouldLoseDriver(eventId, removeTechId) {
  const p = planOf(eventId);
  const rest = p.techs.filter((id) => id !== removeTechId);
  return rest.length > 0 && !rest.some((id) => techById(id)?.has_license) && techById(removeTechId)?.has_license;
}

async function assign(type, id, eventId, fromEventId = '') {
  if (fromEventId === eventId) return;
  const ev = eventById(eventId);
  if (!ev) return;
  const p = planOf(eventId);
  const key = type === 'tech' ? 'techs' : 'vans';
  if (p[key].includes(id)) { toast('Ya estaba asignado a este trabajo.'); return; }
  const r = type === 'tech' ? techById(id) : vanById(id);
  const name = type === 'tech' ? r.name : vanLabel(r);
  const warnings = [];
  // Conflictos (sin contar el trabajo de origen si se está moviendo).
  const plans = { ...state.day.plans };
  if (fromEventId && plans[fromEventId]) plans[fromEventId] = { ...plans[fromEventId], [key]: plans[fromEventId][key].filter((x) => x !== id) };
  const confl = conflictsFor(type, id, eventId, state.day.events, plans);
  for (const o of confl) warnings.push(`⚠ Conflicto de horario: ${name} ya está en «${o.title}» (${shortTime(o)}), que se solapa con este trabajo.`);
  if (type === 'tech' && state.calc.absences[id]) {
    const abs = state.calc.absences[id].map((x) => eventById(x)?.title).filter(Boolean);
    warnings.push(`⚠ Posible ausencia: el calendario indica «${abs.join('», «')}».`);
  }
  if (type === 'tech' && fromEventId && wouldLoseDriver(fromEventId, id)) {
    warnings.push(`⚠ El trabajo «${eventById(fromEventId)?.title || ''}» se quedará sin conductor (nadie con carnet).`);
  }
  let replace = false;
  if (type === 'van' && p.vans.length) {
    replace = true;
    warnings.push(`Se sustituirá ${p.vans.map((v) => vanLabel(vanById(v))).join(', ')} por ${name}. (Para llevar dos furgonetas usa «Asignar…».)`);
  }
  if (warnings.some((w) => w.startsWith('⚠')) || (replace && warnings.length)) {
    const ok = await confirmDialog({ title: `Asignar ${name}`, lines: [...warnings, `Trabajo: «${ev.title}» (${shortTime(ev)}).`], ok: 'Asignar igualmente' });
    if (!ok) return;
  }
  try {
    const res = await api('POST', '/api/assign', { date: state.date, eventId, type, resourceId: id, fromEventId: fromEventId || undefined, replace });
    applyPlans(res.plans);
    if (confl.length) toast(`${name} asignado con conflicto de horario.`, { kind: 'warn' });
    return true;
  } catch (e) { toast(e.message, { kind: 'error' }); if (e.code === 'EVENT_GONE') loadDay(true); return false; }
}

async function unassign(type, id, eventId, { silent = false } = {}) {
  const r = type === 'tech' ? techById(id) : vanById(id);
  const name = type === 'tech' ? r?.name : r && vanLabel(r);
  if (type === 'tech' && wouldLoseDriver(eventId, id)) {
    const ok = await confirmDialog({
      title: 'El grupo se quedará sin conductor',
      lines: [`Si quitas a ${name}, nadie del grupo de «${eventById(eventId)?.title || ''}» tendrá carnet de conducir (*).`, 'Cada grupo necesita al menos un técnico con carnet.'],
      ok: 'Quitar igualmente', danger: true,
    });
    if (!ok) return;
  }
  try {
    const res = await api('POST', '/api/unassign', { date: state.date, eventId, type, resourceId: id });
    applyPlans(res.plans);
    if (!silent) toast(`${name} quitado del trabajo.`, { action: { label: 'Deshacer', fn: () => assign(type, id, eventId) } });
  } catch (e) { toast(e.message, { kind: 'error' }); }
}

async function setPlan(eventId, techs, vans) {
  try {
    const res = await api('PUT', '/api/plan', { date: state.date, eventId, techs, vans });
    applyPlans(res.plans);
  } catch (e) { toast(e.message, { kind: 'error' }); }
}

async function toggleComplete(eventId) {
  const p = planOf(eventId);
  const want = !p.completed;
  if (want && !p.techs.some((id) => techById(id)?.has_license)) {
    await confirmDialog({
      title: 'Grupo sin conductor', alertOnly: true,
      lines: ['No se puede marcar como completo: el grupo no tiene ningún técnico con carnet de conducir (*).', 'Asigna al menos un técnico con asterisco.'],
    });
    return;
  }
  try {
    const res = await api('POST', '/api/complete', { date: state.date, eventId, completed: want });
    applyPlans(res.plans);
  } catch (e) { toast(e.message, { kind: 'error' }); }
}

function toggleSelect(type, id) {
  if (state.selected && state.selected.type === type && state.selected.id === id) state.selected = null;
  else state.selected = { type, id };
  render();
  if (state.selected && window.matchMedia('(max-width: 900px)').matches) document.body.classList.remove('sheet-open');
}

// ---------- Carga de datos ---------------------------------------------------------------

function recompute() {
  state.calc = computeDay(state.day.events, state.day.plans, state.res.techs, state.res.vans);
}

async function loadResources() {
  state.res = await api('GET', '/api/resources');
}

let loadSeq = 0;
async function loadDay(refresh = false) {
  const seq = ++loadSeq;
  state.loading = true;
  renderSync();
  try {
    const d = await api('GET', `/api/day?date=${state.date}${refresh ? '&refresh=1' : ''}`);
    if (seq !== loadSeq) return;
    state.day = d;
    state.today = d.today;
    recompute();
  } catch (e) {
    if (seq === loadSeq) toast(e.message, { kind: 'error' });
  } finally {
    if (seq === loadSeq) { state.loading = false; render(); }
  }
}

function setDate(d) {
  state.date = d;
  state.selected = null;
  loadDay();
}

// ---------- Render ----------------------------------------------------------------------

function render() {
  document.body.dataset.view = state.view;
  document.body.classList.toggle('readonly', !isEditor());
  renderHeader();
  renderBanner();
  if (state.view === 'board') renderBoard();
  else if (state.view === 'display') renderDisplay();
  else if (state.view === 'settings') renderSettings();
}

function renderHeader() {
  $('#date-label').textContent = longDate(state.date);
  $('#date-input').value = state.date;
  $('#btn-today').disabled = state.date === state.today;
  $('#btn-today').textContent = state.date === state.today ? 'Hoy' : 'Ir a hoy';
  for (const b of document.querySelectorAll('[data-nav]')) b.classList.toggle('active', b.dataset.nav === state.view);
  renderSync();
}

function renderSync() {
  const el = $('#sync');
  if (!el || !state.day) return;
  const err = state.day.error;
  el.className = `sync${err ? ' sync-error' : ''}${state.loading ? ' sync-loading' : ''}`;
  el.textContent = state.loading ? 'Sincronizando…' : err ? `Error de sincronización · último dato ${relTime(state.day.syncedAt)}` : `Sincronizado ${relTime(state.day.syncedAt)}`;
  el.title = err ? err.message : state.day.syncedAt ? `Última sincronización: ${fmtDateTime.format(state.day.syncedAt)}` : '';
  const ds = $('#display-sync');
  if (ds) ds.textContent = err ? 'Sin conexión con el calendario' : `Actualizado ${relTime(state.day.syncedAt)}`;
}

function renderBanner() {
  const b = $('#banner');
  const st = state.day.status || {};
  const items = [];
  if (st.demo) items.push(h('div', { class: 'banner demo' }, h('strong', {}, 'MODO DEMOSTRACIÓN. '), 'Los trabajos que ves son ficticios y no proceden del calendario real. Configura CALENDAR_PROVIDER=google (o microsoft) para usar el calendario de info@.'));
  if (!st.configured && !st.demo) {
    items.push(h('div', { class: 'banner error' }, h('strong', {}, 'Calendario sin configurar. '), 'No se muestra ningún trabajo hasta conectar el calendario en el servidor. ', isEditor() ? h('a', { href: '/ajustes', 'data-link': '' }, 'Ver ajustes') : null));
  } else if (state.day.error) {
    const notConnected = state.day.error.code === 'NOT_CONNECTED';
    items.push(h('div', { class: 'banner error' }, h('strong', {}, notConnected ? 'Google Calendar no conectado. ' : 'No se pudo leer el calendario. '),
      state.day.error.message, state.day.syncedAt ? ` Se muestran los últimos datos recibidos (${relTime(state.day.syncedAt)}).` : '',
      notConnected && isEditor() ? h('a', { href: '/ajustes', 'data-link': '' }, ' Conectar ahora') : null));
  }
  b.replaceChildren(...items);
}

// ----- Tablero -----

function renderBoard() {
  renderResources();
  renderJobs();
  renderSelectionBar();
}

function useCount(type, id) { return state.calc?.use?.[type]?.[id]?.length || 0; }

function renderResources() {
  const aside = $('#resources-body');
  const techs = state.res.techs.filter((t) => t.active);
  const groups = [['almacen', 'Personal almacén'], ['tecnico', 'Personal técnico']];
  const free = techs.filter((t) => !useCount('tech', t.id) && !state.calc?.absences?.[t.id]);
  aside.replaceChildren(
    isEditor() ? h('p', { class: 'hint' }, 'Arrastra las fichas a un trabajo (en el móvil, mantén pulsado y arrastra) o toca una ficha y pulsa «Asignar aquí».') : null,
    ...groups.map(([area, label]) => {
      const list = techs.filter((t) => t.area === area);
      if (!list.length) return null;
      return h('section', { class: 'res-group' }, h('h3', {}, label), h('div', { class: 'chips' }, list.map((t) => techChip(t, { count: useCount('tech', t.id) }))));
    }),
    h('section', { class: 'res-group' }, h('h3', {}, 'Furgonetas'),
      h('div', { class: 'chips' }, state.res.vans.filter((v) => v.active).map((v) => vanChip(v, { count: useCount('van', v.id) })))),
    h('section', { class: 'res-group free' }, h('h3', {}, `Sin trabajo hoy (${free.length})`),
      h('p', { class: 'free-list' }, free.length ? free.map((t) => t.name).join(', ') : 'Todos los técnicos tienen trabajo asignado.')),
    renderLegend(),
  );
}

function renderLegend() {
  return h('details', { class: 'legend' }, h('summary', {}, 'Leyenda de colores'),
    h('ul', {},
      state.res.profiles.map((p) => h('li', {}, h('span', { class: 'swatch', style: { '--sw': p.color } }), p.name)),
      h('li', {}, h('span', { class: 'swatch pending' }), 'Pendiente de confirmar'),
      h('li', {}, h('strong', {}, '* '), 'Tiene carnet de conducir')),
    h('ul', {}, state.res.vanTypes.map((p) => h('li', {}, h('span', { class: 'swatch van', style: { '--sw': p.color } }), `Furgoneta ${p.name.toLowerCase()}`))));
}

function renderSelectionBar() {
  const bar = $('#selection-bar');
  const s = state.selected;
  if (!s || !isEditor()) { bar.hidden = true; return; }
  const r = s.type === 'tech' ? techById(s.id) : vanById(s.id);
  bar.hidden = false;
  bar.replaceChildren(
    h('span', {}, 'Seleccionado: '), s.type === 'tech' ? techChip(r, { from: '-' }) : vanChip(r, { from: '-' }),
    h('span', { class: 'sel-hint' }, 'Pulsa «Asignar aquí» en un trabajo.'),
    h('button', { class: 'btn', type: 'button', onclick: () => { state.selected = null; render(); } }, 'Cancelar'));
}

function summaryBar() {
  const s = state.calc?.summary || {};
  const item = (n, label, cls) => h('span', { class: `sum ${cls || ''}${n ? '' : ' zero'}` }, h('strong', {}, String(n ?? 0)), ` ${label}`);
  return h('div', { class: 'summary', role: 'status' },
    item(s.total, s.total === 1 ? 'trabajo' : 'trabajos'),
    item(s.sinAsignar, 'sin asignar', 'st-unassigned'),
    item(s.sinConductor, 'sin conductor', 'st-nodriver'),
    item(s.conflictos, 'con conflicto', 'st-conflict'),
    item(s.completos, 'completos', 'st-complete'));
}

function renderJobs() {
  const wrap = $('#jobs');
  const evs = state.day.events;
  const content = [summaryBar(),
    h('p', { class: 'internal-note' }, 'ℹ️ Las asignaciones son planificación interna de Delaire 2000. No crean, modifican ni borran nada en el calendario.')];
  if (!evs.length) {
    content.push(h('div', { class: 'empty' }, state.loading ? 'Cargando trabajos…'
      : state.day.error || !state.day.status?.configured ? 'No hay datos del calendario disponibles.' : 'No hay trabajos en el calendario para este día.'));
  }
  const allDay = evs.filter((e) => e.allDay);
  const timed = evs.filter((e) => !e.allDay);
  if (allDay.length) content.push(h('h2', { class: 'section-title' }, `Todo el día (${allDay.length})`), h('div', { class: 'job-list' }, allDay.map(jobCard)));
  if (timed.length) content.push(h('h2', { class: 'section-title' }, `Con horario (${timed.length})`), h('div', { class: 'job-list' }, timed.map(jobCard)));
  if (state.day.orphans?.length) content.push(orphansBlock());
  wrap.replaceChildren(...content);
}

function jobCard(e) {
  const j = state.calc.jobs[e.id];
  const main = j.status.includes('conflicto') ? 'conflicto' : j.status[0];
  const hints = titleHints(e.title, state.res.techs.filter((t) => t.active), state.res.vans.filter((v) => v.active));
  const hintNew = hints.techs.some((id) => !j.techs.includes(id)) || hints.vans.some((id) => !j.vans.includes(id));
  const sel = state.selected;
  const conflictIds = new Set(j.conflicts.map((c) => `${c.type}:${c.id}`));

  const team = j.techs.map((id) => {
    const t = techById(id);
    if (!t) return null;
    const c = techChip(t, { from: e.id, removable: true });
    if (conflictIds.has(`tech:${id}`)) c.classList.add('in-conflict');
    if (j.absent.includes(id)) c.classList.add('absent');
    return c;
  });
  const vans = j.vans.map((id) => {
    const v = vanById(id);
    if (!v) return null;
    const c = vanChip(v, { from: e.id, removable: true });
    if (conflictIds.has(`van:${id}`)) c.classList.add('in-conflict');
    return c;
  });

  return h('article', {
    class: `job status-${main}${j.completed ? ' is-complete' : ''}`,
    dataset: { dropEvent: e.id }, 'aria-label': `${shortTime(e)} ${e.title}`,
  },
  h('header', { class: 'job-head' },
    h('div', { class: 'job-time' }, timeLabel(e)),
    h('div', { class: 'job-badges' }, j.status.map(badge))),
  h('h3', { class: 'job-title' }, h('button', { type: 'button', class: 'link-title', onclick: () => openDetail(e.id) }, e.title)),
  e.location ? h('a', { class: 'job-loc', href: mapsUrl(e.location), target: '_blank', rel: 'noopener noreferrer', 'data-no-drag': '' }, '📍 ', e.location) : h('div', { class: 'job-loc muted' }, 'Sin ubicación'),
  h('div', { class: 'job-slot' },
    h('div', { class: 'slot-label' }, 'Equipo', j.techs.length ? ` (${j.techs.length})` : '', !j.hasDriver && j.techs.length ? h('span', { class: 'slot-warn' }, ' · falta conductor (*)') : null),
    h('div', { class: 'chips' }, team.length ? team : h('span', { class: 'drop-hint' }, isEditor() ? 'Arrastra técnicos aquí' : 'Sin técnicos'))),
  h('div', { class: 'job-slot' },
    h('div', { class: 'slot-label' }, 'Furgoneta'),
    h('div', { class: 'chips' }, vans.length ? vans : h('span', { class: 'drop-hint' }, isEditor() ? 'Arrastra una furgoneta aquí' : 'Sin furgoneta'))),
  j.conflicts.length ? h('ul', { class: 'conflicts' }, j.conflicts.map((c) => {
    const r = c.type === 'tech' ? techById(c.id) : vanById(c.id);
    const n = c.type === 'tech' ? r?.name : r && vanLabel(r);
    return h('li', {}, `⚠ ${n} también está en: `, c.with.map((id) => { const o = eventById(id); return `«${o?.title}» (${o ? shortTime(o) : ''})`; }).join(', '));
  })) : null,
  isEditor() && hintNew && (hints.techs.length || hints.vans.length) ? h('div', { class: 'hints' },
    h('span', {}, 'El título menciona: ',
      [...hints.techs.map((id) => techById(id)?.name), ...hints.vans.map((id) => vanLabel(vanById(id)))].join(', ')),
    h('button', { type: 'button', class: 'btn btn-small', onclick: () => applyHints(e.id, hints) }, 'Añadir a la planificación')) : null,
  isEditor() ? h('footer', { class: 'job-actions' },
    sel && !planOf(e.id)[sel.type === 'tech' ? 'techs' : 'vans'].includes(sel.id) ? h('button', { type: 'button', class: 'btn btn-primary assign-here', onclick: async () => {
      const s = state.selected;
      if (await assign(s.type, s.id, e.id)) { state.selected = null; render(); }
    } },
      `Asignar ${sel.type === 'tech' ? techById(sel.id)?.name : vanLabel(vanById(sel.id))} aquí`) : null,
    h('button', { type: 'button', class: 'btn', onclick: () => openPicker(e.id) }, 'Asignar…'),
    h('button', { type: 'button', class: 'btn', onclick: () => openDetail(e.id) }, 'Detalles'),
    h('button', { type: 'button', class: `btn ${j.completed ? 'btn-ok' : ''}`, 'aria-pressed': String(j.completed), onclick: () => toggleComplete(e.id) }, j.completed ? '✓ Grupo completo' : 'Marcar completo'))
    : h('footer', { class: 'job-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => openDetail(e.id) }, 'Detalles')));
}

async function applyHints(eventId, hints) {
  const p = planOf(eventId);
  const techs = [...new Set([...p.techs, ...hints.techs])];
  const vans = [...new Set([...p.vans, ...hints.vans])];
  await savePlanWithChecks(eventId, techs, vans);
}

function orphansBlock() {
  return h('section', { class: 'orphans' },
    h('h2', { class: 'section-title' }, 'Planificación de trabajos que ya no están en el calendario este día'),
    h('p', { class: 'muted' }, 'El evento se ha movido a otro día o se ha borrado en el calendario. Revisa y vuelve a asignar si hace falta.'),
    state.day.orphans.map((o) => h('div', { class: 'orphan' },
      h('strong', {}, o.title || 'Trabajo sin título guardado'),
      h('div', { class: 'chips' },
        o.plan.techs.map((id) => techById(id) && techChip(techById(id), { from: '-' })),
        o.plan.vans.map((id) => vanById(id) && vanChip(vanById(id), { from: '-' }))),
      isEditor() ? h('button', { type: 'button', class: 'btn btn-small', onclick: async () => {
        try { applyPlans((await api('POST', '/api/orphan/clear', { date: state.date, eventId: o.eventId })).plans); loadDay(); } catch (e) { toast(e.message, { kind: 'error' }); }
      } }, 'Descartar') : null)));
}

// ----- Detalle del evento -----

function openDetail(eventId) {
  const e = eventById(eventId);
  if (!e) return;
  const j = state.calc.jobs[e.id];
  const d = $('#dlg-detail');
  const row = (k, v) => (v ? h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v)) : null);
  d.replaceChildren(h('form', { method: 'dialog', class: 'dlg-body detail' },
    h('div', { class: 'dlg-top' }, h('h2', {}, e.title), h('button', { class: 'btn-close', value: 'close', 'aria-label': 'Cerrar' }, '×')),
    h('div', { class: 'job-badges' }, j.status.map(badge)),
    h('dl', {},
      row('Fecha', longDate(state.date)),
      row('Horario', e.allDay ? `Todo el día${e.multiDay ? ` (del ${e.startDate} al ${addDays(e.endDate, -1)})` : ''}` : `${fmtDateTime.format(e.start)} – ${fmtDateTime.format(e.end)}`),
      row('Ubicación', e.location ? h('a', { href: mapsUrl(e.location), target: '_blank', rel: 'noopener noreferrer' }, e.location) : null),
      row('Equipo', j.techs.length ? h('div', { class: 'chips' }, j.techs.map((id) => techById(id) && techChip(techById(id), { from: '-' }))) : 'Sin asignar'),
      row('Furgoneta', j.vans.length ? h('div', { class: 'chips' }, j.vans.map((id) => vanById(id) && vanChip(vanById(id), { from: '-' }))) : 'Sin furgoneta'),
      row('Organizador', e.organizer),
      row('Asistentes', e.attendees?.length ? e.attendees.join(', ') : null),
      row('Categorías', e.categories?.length ? e.categories.join(', ') : null),
      row('Repetición', e.recurring ? 'Evento periódico' : null),
      row('Última modificación', e.updated ? fmtDateTime.format(Date.parse(e.updated)) : null)),
    h('h3', {}, 'Descripción'),
    h('div', { class: 'description' }, e.description || 'Sin descripción.'),
    h('p', { class: 'muted small' }, 'Datos leídos del calendario en modo solo lectura. Para cambiar el evento, edítalo en el propio calendario.'),
    h('div', { class: 'dlg-actions' },
      e.link ? h('a', { class: 'btn', href: e.link, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir en el calendario') : null,
      isEditor() ? h('button', { type: 'button', class: 'btn', onclick: () => { d.close(); openPicker(e.id); } }, 'Asignar…') : null,
      h('button', { class: 'btn btn-primary', value: 'close' }, 'Cerrar'))));
  d.showModal();
}

// ----- Selector accesible (móvil / teclado) -----

function openPicker(eventId) {
  const e = eventById(eventId);
  if (!e) return;
  const p = planOf(eventId);
  const selT = new Set(p.techs), selV = new Set(p.vans);
  const d = $('#dlg-picker');
  const busy = (type, id) => conflictsFor(type, id, eventId, state.day.events, state.day.plans);

  const item = (type, r, set) => {
    const others = busy(type, r.id);
    const absent = type === 'tech' && state.calc.absences[r.id];
    const input = h('input', { type: 'checkbox', checked: set.has(r.id), onchange: (ev) => { ev.target.checked ? set.add(r.id) : set.delete(r.id); updateWarn(); } });
    return h('label', { class: 'pick' }, input,
      type === 'tech' ? techChip(r, { from: '-' }) : vanChip(r, { from: '-' }),
      others.length ? h('span', { class: 'pick-warn' }, `Ocupado: ${others.map((o) => shortTime(o)).join(', ')}`) : null,
      absent ? h('span', { class: 'pick-warn' }, 'Posible ausencia') : null,
      !others.length && !absent && useCount(type, r.id) && !set.has(r.id) ? h('span', { class: 'pick-info' }, `${useCount(type, r.id)} trabajo(s) hoy`) : null);
  };
  const warn = h('p', { class: 'pick-status', role: 'status' });
  function updateWarn() {
    const techs = [...selT];
    const drv = techs.some((id) => techById(id)?.has_license);
    warn.textContent = !techs.length ? 'Sin técnicos asignados.' : drv ? `${techs.length} técnico(s), con conductor.` : `⚠ ${techs.length} técnico(s), pero ninguno tiene carnet (*).`;
    warn.className = `pick-status ${techs.length && !drv ? 'warn' : ''}`;
  }
  updateWarn();
  const techs = state.res.techs.filter((t) => t.active || selT.has(t.id));
  const vans = state.res.vans.filter((v) => v.active || selV.has(v.id));
  d.replaceChildren(h('form', { method: 'dialog', class: 'dlg-body picker' },
    h('div', { class: 'dlg-top' }, h('h2', {}, 'Asignar al trabajo'), h('button', { class: 'btn-close', value: 'cancel', 'aria-label': 'Cerrar' }, '×')),
    h('p', { class: 'muted' }, `${shortTime(e)} · ${e.title}`),
    h('fieldset', {}, h('legend', {}, 'Técnicos'), h('div', { class: 'pick-list' }, techs.map((t) => item('tech', t, selT)))),
    h('fieldset', {}, h('legend', {}, 'Furgonetas'), h('div', { class: 'pick-list' }, vans.map((v) => item('van', v, selV)))),
    warn,
    h('div', { class: 'dlg-actions sticky' },
      h('button', { class: 'btn', value: 'cancel' }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', value: 'ok' }, 'Guardar'))));
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    await savePlanWithChecks(eventId, [...selT], [...selV]);
  };
  d.returnValue = '';
  d.showModal();
}

async function savePlanWithChecks(eventId, techs, vans) {
  const lines = [];
  const plans = { ...state.day.plans, [eventId]: { ...planOf(eventId), techs, vans } };
  for (const id of techs) for (const o of conflictsFor('tech', id, eventId, state.day.events, plans)) lines.push(`⚠ ${techById(id).name} también está en «${o.title}» (${shortTime(o)}).`);
  for (const id of vans) for (const o of conflictsFor('van', id, eventId, state.day.events, plans)) lines.push(`⚠ ${vanLabel(vanById(id))} también está en «${o.title}» (${shortTime(o)}).`);
  for (const id of techs) if (state.calc.absences[id]) lines.push(`⚠ Posible ausencia de ${techById(id).name} según el calendario.`);
  if (techs.length && !techs.some((id) => techById(id)?.has_license)) lines.push('⚠ El grupo no tiene ningún técnico con carnet de conducir (*).');
  if (lines.length) {
    const ok = await confirmDialog({ title: 'Revisa la asignación', lines, ok: 'Guardar igualmente' });
    if (!ok) return;
  }
  await setPlan(eventId, techs, vans);
}

// ----- Pantalla de planificación (TV) -----

function renderDisplay() {
  const root = $('#display');
  const evs = state.day.events;
  const many = evs.length > 8;
  root.classList.toggle('dense', many);
  $('#display-date').textContent = longDate(state.date);
  const s = state.calc?.summary || {};
  $('#display-summary').replaceChildren(...[
    h('span', {}, `${s.total || 0} trabajos`),
    s.sinAsignar && h('span', { class: 'ds-unassigned' }, `${s.sinAsignar} sin asignar`),
    s.sinConductor && h('span', { class: 'ds-nodriver' }, `${s.sinConductor} sin conductor`),
    s.conflictos && h('span', { class: 'ds-conflict' }, `${s.conflictos} con conflicto`)].filter(Boolean));
  tickClock();
  const allDay = evs.filter((e) => e.allDay && !(state.calc.jobs[e.id].techs.length || state.calc.jobs[e.id].vans.length));
  const cards = evs.filter((e) => !allDay.includes(e));
  $('#display-notes').replaceChildren(...allDay.map((e) => h('span', { class: 'note' }, e.title)));
  $('#display-notes').hidden = !allDay.length;
  $('#display-grid').replaceChildren(...(cards.length ? cards.map(displayCard)
    : [h('div', { class: 'empty big' }, state.day.error ? 'Sin conexión con el calendario' : 'No hay trabajos para este día')]));
  renderSync();
}

function displayCard(e) {
  const j = state.calc.jobs[e.id];
  const main = j.status.includes('conflicto') ? 'conflicto' : j.status[0];
  return h('article', { class: `dcard status-${main}` },
    h('div', { class: 'dcard-time' }, e.allDay ? 'Todo el día' : `${fmtTime.format(e.start)} – ${fmtTime.format(e.end)}`),
    h('h3', { class: 'dcard-title' }, e.title),
    e.location ? h('div', { class: 'dcard-loc' }, '📍 ', e.location) : null,
    h('div', { class: 'dcard-team' },
      j.techs.length ? j.techs.map((id) => techById(id) && techChip(techById(id), { from: '-', big: true })) : h('span', { class: 'dcard-empty' }, 'Sin técnicos'),
      j.vans.map((id) => vanById(id) && vanChip(vanById(id), { from: '-', big: true }))),
    h('div', { class: 'job-badges' }, j.status.filter((x) => x !== 'asignado').map(badge)));
}

// Desplazamiento automático en la TV si no cabe todo.
let scrollDir = 1, scrollPause = 0;
setInterval(() => {
  if (state.view !== 'display') return;
  const g = $('#display-grid');
  if (!g || g.scrollHeight <= g.clientHeight + 4) return;
  if (scrollPause > 0) { scrollPause--; return; }
  g.scrollTop += scrollDir;
  if (g.scrollTop + g.clientHeight >= g.scrollHeight - 1) { scrollDir = -1; scrollPause = 80; }
  else if (g.scrollTop <= 0) { scrollDir = 1; scrollPause = 80; }
}, 50);

function tickClock() {
  const c = $('#display-clock');
  if (c && fmtTime) c.textContent = fmtTime.format(Date.now());
}
setInterval(tickClock, 1000);

// ----- Ajustes -----

async function renderSettings() {
  const root = $('#settings');
  if (!isEditor()) { root.replaceChildren(h('p', {}, 'Solo los editores pueden ver los ajustes.')); return; }
  const st = state.day.status || {};
  const save = async (method, url, body) => {
    try { state.res = await api(method, url, body); recompute(); renderSettings(); toast('Guardado.'); } catch (e) { toast(e.message, { kind: 'error' }); }
  };
  const params = new URLSearchParams(location.search);
  const gmsg = params.get('google');

  const colorRow = (item, url) => h('tr', {},
    h('td', {}, h('span', { class: 'chip', style: { '--chip-bg': item.color, '--chip-fg': item.text_color } }, h('span', { class: 'chip-label' }, 'EJEMPLO'))),
    h('td', {}, h('input', { type: 'text', value: item.name, 'aria-label': 'Nombre', maxlength: '40', onchange: (ev) => save('PUT', url, { name: ev.target.value }) })),
    h('td', {}, h('input', { type: 'color', value: item.color, 'aria-label': 'Color de fondo', onchange: (ev) => save('PUT', url, { color: ev.target.value }) })),
    h('td', {}, h('input', { type: 'color', value: item.text_color, 'aria-label': 'Color del texto', onchange: (ev) => save('PUT', url, { text_color: ev.target.value }) })));

  const profileOptions = (cur) => [h('option', { value: '', selected: !cur }, '⚠ Pendiente de confirmar'),
    ...state.res.profiles.map((p) => h('option', { value: p.id, selected: p.id === cur }, p.name))];
  const typeOptions = (cur) => [h('option', { value: '', selected: !cur }, '⚠ Pendiente de confirmar'),
    ...state.res.vanTypes.map((p) => h('option', { value: p.id, selected: p.id === cur }, p.name))];

  const newTech = { name: '', area: 'tecnico', profile_id: '', has_license: false };
  const newVan = { model: '', plate: '', type_id: '' };

  root.replaceChildren(
    h('h1', {}, 'Ajustes'),
    h('section', { class: 'card' },
      h('h2', {}, 'Calendario (solo lectura)'),
      gmsg === 'ok' ? h('p', { class: 'banner ok' }, 'Google Calendar conectado correctamente con permiso de solo lectura.') : null,
      gmsg === 'error' ? h('p', { class: 'banner error' }, `No se pudo conectar: ${params.get('msg') || ''}`) : null,
      gmsg === 'denegado' ? h('p', { class: 'banner error' }, 'Se canceló la autorización en Google.') : null,
      h('dl', { class: 'status-list' },
        h('div', { class: 'kv' }, h('dt', {}, 'Proveedor'), h('dd', {}, st.provider ? { google: 'Google Calendar', microsoft: 'Microsoft 365 / Outlook', demo: 'Demostración (ficticio)' }[st.provider] : 'Sin configurar')),
        st.google ? h('div', { class: 'kv' }, h('dt', {}, 'Calendario'), h('dd', {}, st.google.calendarId)) : null,
        st.google ? h('div', { class: 'kv' }, h('dt', {}, 'Acceso'), h('dd', {}, st.google.mode === 'service_account' ? 'Cuenta de servicio' : st.google.mode === 'oauth' ? (st.google.oauthConnected ? 'OAuth · conectado' : 'OAuth · pendiente de conectar') : 'Sin credenciales')) : null,
        st.google ? h('div', { class: 'kv' }, h('dt', {}, 'Permiso'), h('dd', {}, h('code', {}, st.google.scope))) : null,
        st.microsoft ? h('div', { class: 'kv' }, h('dt', {}, 'Buzón'), h('dd', {}, st.microsoft.calendarUser)) : null,
        st.microsoft ? h('div', { class: 'kv' }, h('dt', {}, 'Permiso'), h('dd', {}, h('code', {}, st.microsoft.permission))) : null,
        h('div', { class: 'kv' }, h('dt', {}, 'Zona horaria'), h('dd', {}, st.timeZone)),
        h('div', { class: 'kv' }, h('dt', {}, 'Actualización automática'), h('dd', {}, `cada ${st.syncIntervalSeconds} s`)),
        h('div', { class: 'kv' }, h('dt', {}, 'Última lectura correcta'), h('dd', {}, st.lastSuccessAt ? fmtDateTime.format(st.lastSuccessAt) : 'nunca')),
        st.lastError ? h('div', { class: 'kv' }, h('dt', {}, 'Último error'), h('dd', { class: 'error-text' }, st.lastError.message)) : null),
      st.google?.mode === 'oauth' ? h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: '/oauth/google/start' }, st.google.oauthConnected ? 'Volver a conectar Google Calendar' : 'Conectar Google Calendar (solo lectura)'),
        st.google.oauthConnected ? h('button', { type: 'button', class: 'btn', onclick: async () => {
          if (!(await confirmDialog({ title: 'Desconectar Google', lines: ['La aplicación dejará de leer el calendario hasta que se vuelva a conectar.'], ok: 'Desconectar', danger: true }))) return;
          await api('POST', '/api/google/disconnect'); location.href = '/ajustes';
        } }, 'Desconectar') : null) : null,
      h('p', { class: 'muted small' }, 'La aplicación nunca crea, edita, mueve ni borra eventos. Los pasos de configuración están en el README del proyecto.')),

    h('section', { class: 'card' },
      h('h2', {}, 'Perfiles de técnicos (colores)'),
      h('p', { class: 'muted small' }, 'Los colores tienen significado operativo. Puedes ajustar el tono o el nombre si hiciera falta.'),
      h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Vista'), h('th', {}, 'Perfil'), h('th', {}, 'Fondo'), h('th', {}, 'Texto'))),
        h('tbody', {}, state.res.profiles.map((p) => colorRow(p, `/api/profiles/${p.id}`))))),

    h('section', { class: 'card' },
      h('h2', {}, 'Técnicos'),
      h('p', { class: 'muted small' }, 'Marca «Carnet» para los que aparecen con asterisco (*). Los marcados como «Pendiente de confirmar» se muestran en blanco con «?».'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Ficha'), h('th', {}, 'Nombre'), h('th', {}, 'Área'), h('th', {}, 'Perfil / color'), h('th', {}, 'Carnet (*)'), h('th', {}, 'Activo'))),
        h('tbody', {},
          state.res.techs.map((t) => h('tr', { class: t.active ? '' : 'inactive' },
            h('td', {}, techChip(t, { from: '-' })),
            h('td', {}, h('input', { type: 'text', value: t.name, maxlength: '40', 'aria-label': 'Nombre', onchange: (ev) => save('PUT', `/api/technicians/${t.id}`, { name: ev.target.value }) })),
            h('td', {}, h('select', { 'aria-label': 'Área', onchange: (ev) => save('PUT', `/api/technicians/${t.id}`, { area: ev.target.value }) },
              h('option', { value: 'almacen', selected: t.area === 'almacen' }, 'Almacén'), h('option', { value: 'tecnico', selected: t.area === 'tecnico' }, 'Técnico'))),
            h('td', {}, h('select', { 'aria-label': 'Perfil', onchange: (ev) => save('PUT', `/api/technicians/${t.id}`, { profile_id: ev.target.value || null }) }, profileOptions(t.profile_id))),
            h('td', {}, h('input', { type: 'checkbox', checked: t.has_license, 'aria-label': 'Carnet de conducir', onchange: (ev) => save('PUT', `/api/technicians/${t.id}`, { has_license: ev.target.checked }) })),
            h('td', {}, h('input', { type: 'checkbox', checked: t.active, 'aria-label': 'Activo', onchange: (ev) => save('PUT', `/api/technicians/${t.id}`, { active: ev.target.checked }) })))),
          h('tr', { class: 'new-row' },
            h('td', {}, 'Nuevo'),
            h('td', {}, h('input', { type: 'text', placeholder: 'Nombre', maxlength: '40', oninput: (ev) => (newTech.name = ev.target.value) })),
            h('td', {}, h('select', { onchange: (ev) => (newTech.area = ev.target.value) }, h('option', { value: 'tecnico' }, 'Técnico'), h('option', { value: 'almacen' }, 'Almacén'))),
            h('td', {}, h('select', { onchange: (ev) => (newTech.profile_id = ev.target.value) }, profileOptions(''))),
            h('td', {}, h('input', { type: 'checkbox', 'aria-label': 'Carnet', onchange: (ev) => (newTech.has_license = ev.target.checked) })),
            h('td', {}, h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => save('POST', '/api/technicians', { ...newTech, profile_id: newTech.profile_id || null }) }, 'Añadir'))))))),

    h('section', { class: 'card' },
      h('h2', {}, 'Tipos de furgoneta (colores)'),
      h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Vista'), h('th', {}, 'Tipo'), h('th', {}, 'Fondo'), h('th', {}, 'Texto'))),
        h('tbody', {}, state.res.vanTypes.map((p) => colorRow(p, `/api/van-types/${p.id}`))))),

    h('section', { class: 'card' },
      h('h2', {}, 'Furgonetas'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Ficha'), h('th', {}, 'Modelo'), h('th', {}, 'Matrícula'), h('th', {}, 'Tipo'), h('th', {}, 'Activa'))),
        h('tbody', {},
          state.res.vans.map((v) => h('tr', { class: v.active ? '' : 'inactive' },
            h('td', {}, vanChip(v, { from: '-' })),
            h('td', {}, h('input', { type: 'text', value: v.model, maxlength: '30', 'aria-label': 'Modelo', onchange: (ev) => save('PUT', `/api/vans/${v.id}`, { model: ev.target.value }) })),
            h('td', {}, h('input', { type: 'text', value: v.plate, maxlength: '12', 'aria-label': 'Matrícula', onchange: (ev) => save('PUT', `/api/vans/${v.id}`, { plate: ev.target.value }) })),
            h('td', {}, h('select', { 'aria-label': 'Tipo', onchange: (ev) => save('PUT', `/api/vans/${v.id}`, { type_id: ev.target.value || null }) }, typeOptions(v.type_id))),
            h('td', {}, h('input', { type: 'checkbox', checked: v.active, 'aria-label': 'Activa', onchange: (ev) => save('PUT', `/api/vans/${v.id}`, { active: ev.target.checked }) })))),
          h('tr', { class: 'new-row' },
            h('td', {}, 'Nueva'),
            h('td', {}, h('input', { type: 'text', placeholder: 'Modelo', maxlength: '30', oninput: (ev) => (newVan.model = ev.target.value) })),
            h('td', {}, h('input', { type: 'text', placeholder: 'Matrícula', maxlength: '12', oninput: (ev) => (newVan.plate = ev.target.value) })),
            h('td', {}, h('select', { onchange: (ev) => (newVan.type_id = ev.target.value) }, typeOptions(''))),
            h('td', {}, h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => save('POST', '/api/vans', { ...newVan, type_id: newVan.type_id || null }) }, 'Añadir'))))))),

    h('section', { class: 'card' },
      h('h2', {}, 'Pantalla compartida (TV)'),
      h('p', {}, 'Abre ', h('code', {}, '/pantalla'), ' en el monitor. Para no tener que escribir contraseña en la TV, configura DISPLAY_TOKEN en el servidor y usa el enlace ', h('code', {}, '/pantalla?k=TOKEN'), ' (acceso de solo lectura).')),
  );
}

// ---------- Navegación ------------------------------------------------------------------

function routeFromPath() {
  const p = location.pathname;
  if (!isEditor()) return 'display';
  if (p.startsWith('/pantalla')) return 'display';
  if (p.startsWith('/ajustes')) return 'settings';
  return 'board';
}
function navigate(view) {
  const path = { board: '/', display: '/pantalla', settings: '/ajustes' }[view];
  if (location.pathname !== path) history.pushState({}, '', path);
  state.view = view;
  state.selected = null;
  render();
  if (view === 'board' || view === 'display') loadDay();
}

function bindChrome() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (a) { e.preventDefault(); navigate(routeFromHref(a.getAttribute('href'))); }
  });
  for (const b of document.querySelectorAll('[data-nav]')) b.addEventListener('click', () => navigate(b.dataset.nav));
  window.addEventListener('popstate', () => { state.view = routeFromPath(); render(); });
  $('#btn-prev').addEventListener('click', () => setDate(addDays(state.date, -1)));
  $('#btn-next').addEventListener('click', () => setDate(addDays(state.date, 1)));
  $('#btn-today').addEventListener('click', () => setDate(state.today));
  $('#date-input').addEventListener('change', (e) => { if (e.target.value) setDate(e.target.value); });
  $('#date-label').addEventListener('click', () => { const i = $('#date-input'); i.showPicker ? i.showPicker() : i.focus(); });
  $('#btn-refresh').addEventListener('click', () => loadDay(true));
  $('#btn-logout').addEventListener('click', async () => { await api('POST', '/api/logout'); location.href = '/login.html'; });
  $('#btn-sheet').addEventListener('click', () => document.body.classList.toggle('sheet-open'));
  $('#btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  $('#btn-exit-display').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); navigate('board'); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, dialog')) return;
    if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
    if (state.view === 'settings') return;
    if (e.key === 'ArrowLeft' && e.altKey) setDate(addDays(state.date, -1));
    if (e.key === 'ArrowRight' && e.altKey) setDate(addDays(state.date, 1));
  });
  // En la TV, el cursor y el botón de salir se ocultan tras unos segundos sin moverse.
  let idle;
  document.addEventListener('pointermove', () => {
    document.body.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add('idle'), 4000);
  });
}
const routeFromHref = (href) => (href.startsWith('/ajustes') ? 'settings' : href.startsWith('/pantalla') ? 'display' : 'board');

// ---------- Tiempo real -----------------------------------------------------------------

let reloadTimer;
function scheduleReload(refreshResources = false) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    if (refreshResources) await loadResources().catch(() => {});
    if (state.view !== 'settings') loadDay(); else { recompute(); render(); }
  }, 300);
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('day-changed', (m) => { if (JSON.parse(m.data).date === state.date) scheduleReload(); });
  es.addEventListener('plan-changed', (m) => { if (JSON.parse(m.data).date === state.date) scheduleReload(); });
  es.addEventListener('resources-changed', () => scheduleReload(true));
  es.onerror = () => {}; // EventSource reintenta solo
}

// ---------- Arranque --------------------------------------------------------------------

async function main() {
  const me = await api('GET', '/api/me');
  state.role = me.role;
  state.tz = me.timeZone;
  state.today = me.today;
  state.date = me.today; // al abrir, siempre el día actual
  state.day.status = me.status;
  initFormats();
  await loadResources();
  recompute();
  state.view = routeFromPath();
  if (!isEditor() && !location.pathname.startsWith('/pantalla')) history.replaceState({}, '', '/pantalla');
  bindChrome();
  initDragAndDrop({
    enabled: () => isEditor() && state.view === 'board',
    onHover: (target, data) => {
      if (target.dataset.dropRemove != null) return 'ok';
      return conflictsFor(data.type, data.id, target.dataset.dropEvent, state.day.events, state.day.plans).length ? 'warn' : 'ok';
    },
    onDrop: (target, data) => {
      if (target.dataset.dropRemove != null) { if (data.from) unassign(data.type, data.id, data.from); return; }
      assign(data.type, data.id, target.dataset.dropEvent, data.from);
    },
    onStart: () => document.body.classList.remove('sheet-open'),
  });
  render();
  await loadDay();
  connectStream();
  // Respaldo: refresco periódico, texto "hace X min" y cambio de día a medianoche.
  setInterval(() => {
    const prevToday = state.today;
    api('GET', '/api/me').then((m) => {
      state.today = m.today;
      if (prevToday !== m.today && state.date === prevToday) setDate(m.today);
    }).catch(() => {});
    if (state.view !== 'settings') loadDay();
  }, 60_000);
  setInterval(renderSync, 15_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.view !== 'settings') loadDay(); });
}

main().catch((e) => {
  console.error(e);
  document.body.append(h('p', { class: 'banner error' }, `No se pudo iniciar la aplicación: ${e.message}`));
});
