// Datos iniciales tomados del esquema (organigrama) facilitado por Delaire 2000.
// Los colores tienen significado operativo. Los nombres que en el esquema aparecen en
// blanco no corresponden a ningún perfil de la leyenda: quedan "pendientes de confirmar".

export const PROFILES = [
  { id: 'tecnico', name: 'Perfil más técnico', color: '#FFFF00', text_color: '#111111', sort: 1 },
  { id: 'ayudante', name: 'Perfil más ayudante', color: '#BFBFBF', text_color: '#111111', sort: 2 },
  { id: 'conductos', name: 'Especializado en conductos', color: '#00B0F0', text_color: '#111111', sort: 3 },
  { id: 'sat', name: 'SAT y genérico', color: '#FF0000', text_color: '#111111', sort: 4 },
  { id: 'pladurista', name: 'Pladurista', color: '#92D050', text_color: '#111111', sort: 5 },
];

// profile_id null => color/perfil pendiente de confirmar. has_license = asterisco (*) del esquema.
export const TECHNICIANS = [
  { name: 'Alex', area: 'almacen', profile_id: null, has_license: 1 },
  { name: 'Jose Alm', area: 'almacen', profile_id: null, has_license: 1 },
  { name: 'Luis', area: 'almacen', profile_id: null, has_license: 0 },
  { name: 'Vitiño', area: 'almacen', profile_id: 'tecnico', has_license: 1 },
  { name: 'Ahmed', area: 'tecnico', profile_id: 'tecnico', has_license: 1 },
  { name: 'Alexis', area: 'tecnico', profile_id: 'tecnico', has_license: 0 },
  { name: 'Kike', area: 'tecnico', profile_id: 'sat', has_license: 1 },
  { name: 'Eddy', area: 'tecnico', profile_id: 'pladurista', has_license: 1 },
  { name: 'Rafa', area: 'tecnico', profile_id: 'conductos', has_license: 1 },
  { name: 'Jefferson', area: 'tecnico', profile_id: 'conductos', has_license: 1 },
  { name: 'Matias', area: 'tecnico', profile_id: 'pladurista', has_license: 0 },
  { name: 'Juan', area: 'tecnico', profile_id: 'ayudante', has_license: 1 },
  { name: 'Andres', area: 'tecnico', profile_id: 'sat', has_license: 1 },
  { name: 'Cristian', area: 'tecnico', profile_id: 'pladurista', has_license: 0 },
  { name: 'Diego', area: 'tecnico', profile_id: 'ayudante', has_license: 0 },
  { name: 'Jose', area: 'tecnico', profile_id: 'ayudante', has_license: 0 },
];

export const VAN_TYPES = [
  { id: 'electrica', name: 'Eléctrica', color: '#00B050', text_color: '#111111', sort: 1 },
  { id: 'grande', name: 'Grande', color: '#BFBFBF', text_color: '#111111', sort: 2 },
  { id: 'obra', name: 'Para obra', color: '#FFFF00', text_color: '#111111', sort: 3 },
  { id: 'sat', name: 'Para SAT', color: '#FF0000', text_color: '#111111', sort: 4 },
];

export const VANS = [
  { model: 'Trafic', plate: '0824NLL', type_id: 'electrica' },
  { model: 'Trafic', plate: '0825NLL', type_id: 'electrica' },
  { model: 'Custom', plate: '7077HZD', type_id: 'obra' },
  { model: 'Custom', plate: '2494KPK', type_id: 'obra' },
  { model: 'Trafic', plate: '4398MCW', type_id: 'obra' },
  { model: 'Mercedes', plate: '5020JKD', type_id: 'grande' },
  { model: 'Crafter', plate: '1004HWM', type_id: 'grande' },
  { model: 'Mercedes', plate: '0715JGW', type_id: 'grande' },
  { model: 'Kangoo', plate: '4339HYP', type_id: 'sat' },
  { model: 'Kangoo', plate: '4298HYP', type_id: 'sat' },
];
