// Modo DEMOSTRACIÓN: eventos FICTICIOS solo para probar la interfaz sin credenciales.
// Se activa únicamente con CALENDAR_PROVIDER=demo, usa una base de datos separada y la
// interfaz muestra un aviso permanente. Nunca se mezcla con datos reales.
import { config } from '../config.js';
import { wallTimeToUtc, addDays } from '../time.js';

const SAMPLE = [
  { h: [8, 0], e: [14, 0], t: 'DEMO · Instalación split 1x1 | Cliente de ejemplo A', l: 'Calle Ficticia 1, Madrid', d: 'Evento de demostración.\nNo procede del calendario real.' },
  { h: [8, 30], e: [17, 0], t: 'DEMO · Obra conductos 2 días | Cliente de ejemplo B', l: 'Polígono Ejemplo, Getafe', d: 'Evento de demostración.' },
  { h: [9, 30], e: [11, 0], t: 'DEMO · SAT revisión aerotermia | Cliente de ejemplo C', l: 'Av. Demo 22, Leganés', d: 'Evento de demostración.' },
  { h: [10, 0], e: [13, 30], t: 'DEMO · Mantenimiento cassette | Cliente de ejemplo D', l: 'Plaza Prueba 3, Fuenlabrada', d: 'Evento de demostración.' },
  { h: [15, 0], e: [18, 0], t: 'DEMO · SAT fuga de agua | Cliente de ejemplo E', l: 'Calle Simulada 9, Pinto', d: 'Evento de demostración.' },
];

export async function listDemoEvents(timeMinMs, timeMaxMs) {
  const tz = config.timeZone;
  const out = [];
  // Recorre los días del rango y genera eventos de ejemplo de lunes a viernes.
  let date = new Date(timeMinMs + 12 * 3600e3).toISOString().slice(0, 10);
  while (wallTimeToUtc(...date.split('-').map(Number), 0, 0, 0, tz) < timeMaxMs) {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow >= 1 && dow <= 5) {
      SAMPLE.forEach((s, i) => {
        if ((d + i) % 6 === 0) return; // varía un poco cada día
        out.push({
          id: `demo-${date}-${i}`, title: s.t, description: s.d, location: s.l, allDay: false,
          start: wallTimeToUtc(y, m, d, ...s.h, 0, tz), end: wallTimeToUtc(y, m, d, ...s.e, 0, tz),
          startDate: null, endDate: null, status: 'confirmed', link: '', organizer: 'DEMO', attendees: [],
          categories: [], colorId: null, recurring: false, updated: null, created: null, source: 'demo',
        });
      });
      if (d % 3 === 0) {
        out.push({
          id: `demo-${date}-allday`, title: 'DEMO · VACACIONES DIEGO', description: 'Evento de demostración (ausencia).',
          location: '', allDay: true, start: null, end: null, startDate: date, endDate: addDays(date, 1), status: 'confirmed',
          link: '', organizer: 'DEMO', attendees: [], categories: [], colorId: null, recurring: false, updated: null, created: null, source: 'demo',
        });
      }
    }
    date = addDays(date, 1);
  }
  return out.filter((e) => e.allDay || (e.end > timeMinMs && e.start < timeMaxMs));
}
