# Planificación diaria de técnicos · Delaire 2000

Aplicación web para organizar cada día los trabajos del calendario `info@delaire-2000.com`:
asignar técnicos y furgonetas arrastrando fichas, ver avisos (sin conductor, solapes, ausencias)
y mostrar la planificación en una TV.

> **El calendario solo se lee.** La aplicación no crea, edita, mueve ni borra eventos ni calendarios.
> Las asignaciones son **planificación interna** y se guardan en la base de datos de la propia aplicación.

## Arquitectura

```
Navegador (ordenador · móvil · TV)          Servidor Node.js (este proyecto)             Calendario
 HTML/CSS/JS sin secretos  ──HTTPS──▶  API + sesiones + SQLite (asignaciones) ──GET──▶  Google Calendar
        ▲      (cookie HttpOnly)          sondeo cada 60 s + caché por día      (solo lectura)  o Microsoft 365
        └────── avisos en tiempo real (SSE) ◀─┘
```

- **Servidor** (`server/`): Node.js 22 + Express. Solo él guarda credenciales y habla con el calendario.
- **Lectura del calendario** (`server/calendar/`): un único cliente HTTP que solo hace `GET`
  (`server/calendar/http.js`); no existe ninguna llamada de escritura en el código.
  - Google: permiso único `https://www.googleapis.com/auth/calendar.events.readonly`. Si Google
    devuelve cualquier otro permiso adicional, la conexión se rechaza.
  - Microsoft 365: permiso de aplicación único `Calendars.Read`.
- **Actualización automática**: el servidor vuelve a leer hoy, mañana y los días consultados cada
  `SYNC_INTERVAL_SECONDS` (60 s por defecto). Si algo cambia, todas las pantallas abiertas se actualizan al momento.
  Hay un botón ⟳ para actualizar a mano, y se muestra la hora de la última sincronización.
- **Asignaciones** (`data/planificacion.sqlite`): tabla `assignments` con clave
  *identificador del evento + fecha*. Los eventos periódicos se leen como repeticiones independientes,
  así que cada día tiene su propio identificador. Si un evento se mueve o se borra en el calendario, su planificación
  aparece en «trabajos que ya no están en el calendario» para revisarla.
- **Acceso**: contraseña de editor (planificar) y, opcionalmente, contraseña o enlace con token de solo lectura
  para la TV. Sesiones en el servidor, cookie `HttpOnly`, protección CSRF, límite de intentos y CSP estricta.

## Funciones

- Abre siempre en **el día actual**; flechas ‹ › o el calendario para cambiar de día. Los trabajos van ordenados
  por hora, con los de todo el día primero.
- Tarjetas con **hora, título y ubicación** destacados (la ubicación abre Google Maps). «Detalles» muestra la
  descripción completa y el resto de datos del evento.
- **Fichas de técnicos** con los colores del esquema y el **asterisco (*) de carnet de conducir**:
  - Amarillo = perfil más técnico · Gris = más ayudante · Azul = conductos · Rojo = SAT y genérico · Verde = pladurista.
  - **Alex, Jose Alm y Luis** aparecen en blanco en el esquema y ese color no está en la leyenda, así que quedan
    **«pendiente de confirmar»** (ficha blanca con borde discontinuo y «?»). Se asignan en *Ajustes*.
- **Furgonetas** como recurso aparte: verde = eléctrica, gris = grande, amarillo = obra, rojo = SAT.
- **Arrastrar y soltar** con ratón, o con el dedo manteniendo pulsado. Se puede mover una ficha de un trabajo a otro,
  o quitarla con la × o soltándola sobre el panel de recursos. Tras quitar una ficha aparece «Deshacer».
- **En el móvil**, sin arrastrar: toca una ficha y pulsa «Asignar aquí», o usa «Asignar…» para elegir con casillas.
- **Estados**: Sin asignar · Asignado · Sin conductor · Conflicto de horario · Posible ausencia · Grupo completo.
  - Avisa antes de asignar un técnico o una furgoneta a trabajos que se solapan, de quitar el último conductor
    de un grupo y de asignar a alguien que tiene «VACACIONES / AUSENCIA …» en el calendario.
  - No deja marcar como «Grupo completo» un grupo sin conductor. Tener conductor no marca el grupo como completo:
    los equipos pueden ser de cualquier tamaño.
- **Sugerencias del título**: si el título del evento ya incluye el equipo (p. ej. `… | EDDY + JOSE | TRAFIC 0824NLL`),
  la tarjeta lo propone con el botón «Añadir a la planificación». Nunca se aplica solo.
- **Pantalla de planificación** (`/pantalla`): tema oscuro, letra grande, reloj, sin controles de edición,
  desplazamiento automático si no cabe todo y botón de pantalla completa.
- **Ajustes** (`/ajustes`): colores y nombres de perfiles y tipos de furgoneta, alta y baja de técnicos y furgonetas,
  carnet, área y estado de la conexión con el calendario.

## Puesta en marcha

Requisitos: **Node.js 22.9 o superior**.

```bash
npm install
cp .env.example .env      # y rellena las variables (ver abajo)
npm start                 # http://localhost:3000
npm test                  # pruebas de reglas de planificación y zona horaria
```

Para probar la interfaz sin credenciales: `CALENDAR_PROVIDER=demo`. Se muestran eventos **ficticios** con un aviso
permanente, y se usa una base de datos aparte (`planificacion-demo.sqlite`).

Variables mínimas: `APP_PASSWORD`, `SESSION_SECRET` y la configuración del calendario.

## Conectar el calendario (solo lectura)

> ⚠️ **Antes de nada, comprueba dónde está el calendario.** El dominio `delaire-2000.com` usa **Microsoft 365**
> y los datos que ya hay en este repositorio (`snapshots/`, `informes/`) proceden de **Outlook**.
> Si el calendario de `info@` se gestiona en Outlook/Microsoft 365, usa la opción **Microsoft 365**.
> Si de verdad está en Google Calendar, usa la opción A o la B.

### Google · Opción A (recomendada): cuenta de servicio

Es la más sencilla y no depende de que nadie mantenga una sesión iniciada.

1. En <https://console.cloud.google.com> crea un proyecto (p. ej. «planificacion-delaire»).
2. *APIs y servicios → Biblioteca →* habilita **Google Calendar API**.
3. *IAM → Cuentas de servicio → Crear*. No le asignes ningún rol. En *Claves → Añadir clave → JSON*, descarga el fichero.
4. Guarda el JSON **en el servidor** fuera de la carpeta pública (p. ej. `credenciales/google-sa.json`, ya excluida de git).
5. Entra en Google Calendar con `info@delaire-2000.com` → *Configuración del calendario → Compartir con
   determinadas personas* → añade el correo de la cuenta de servicio (`…@….iam.gserviceaccount.com`) con el permiso
   **«Ver todos los detalles de los eventos»** (nunca «Hacer cambios»).
   - Si es Google Workspace y no deja compartir fuera del dominio, el administrador puede usar en su lugar la
     *delegación de todo el dominio* solo con el ámbito `https://www.googleapis.com/auth/calendar.events.readonly`
     y poner `GOOGLE_IMPERSONATE_USER=info@delaire-2000.com`.
6. En `.env`:
   ```
   CALENDAR_PROVIDER=google
   GOOGLE_CALENDAR_ID=info@delaire-2000.com
   GOOGLE_SERVICE_ACCOUNT_FILE=./credenciales/google-sa.json
   ```

### Google · Opción B: OAuth con la cuenta info@

1. En Google Cloud, habilita **Google Calendar API**.
2. *Pantalla de consentimiento OAuth*: tipo **Interno** si es Workspace. Añade solo el ámbito
   `…/auth/calendar.events.readonly`.
3. *Credenciales → Crear ID de cliente OAuth → Aplicación web*. URI de redirección autorizada:
   `https://TU-DOMINIO/oauth/google/callback` (en local: `http://localhost:3000/oauth/google/callback`).
4. En `.env`: `CALENDAR_PROVIDER=google`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` y `PUBLIC_URL`.
5. Arranca la app, entra como editor → **Ajustes → «Conectar Google Calendar (solo lectura)»** → inicia sesión con
   `info@delaire-2000.com` y acepta. El token se guarda **cifrado** en la base de datos del servidor.

### Microsoft 365 / Outlook

1. En <https://entra.microsoft.com> → *Registros de aplicaciones → Nuevo registro* («Planificación Delaire»).
2. *Permisos de API → Microsoft Graph → Permisos de aplicación →* **`Calendars.Read`** (solo ese) →
   *Conceder consentimiento de administrador*.
3. *Certificados y secretos → Nuevo secreto de cliente*. Copia el valor.
4. **Recomendado**: limita la aplicación solo al buzón `info@` con una *Application Access Policy* de Exchange Online:
   ```powershell
   New-DistributionGroup -Name "PlanificacionCalendario" -Type Security -Members info@delaire-2000.com
   New-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -PolicyScopeGroupId PlanificacionCalendario -AccessRight RestrictAccess -Description "Solo calendario info@"
   ```
5. En `.env`:
   ```
   CALENDAR_PROVIDER=microsoft
   MS_TENANT_ID=…   MS_CLIENT_ID=…   MS_CLIENT_SECRET=…
   MS_CALENDAR_USER=info@delaire-2000.com
   ```

Comprueba la conexión en **Ajustes → Calendario**: debe aparecer «Última lectura correcta». Si hay un error, se
muestra en la cabecera y en Ajustes, sin inventar datos.

## Publicarla para usarla desde el móvil y la TV

- Ejecútala en un servidor o un pequeño equipo de la oficina (con `pm2`, `systemd` o Docker) detrás de **HTTPS**
  (Caddy o nginx). Con HTTPS, pon `COOKIE_SECURE=true` y `TRUST_PROXY=true` si usas un proxy inverso.
- TV: abre `https://TU-DOMINIO/pantalla?k=DISPLAY_TOKEN` (solo lectura) y pulsa «Pantalla completa».
- **Copia de seguridad**: la carpeta `DATA_DIR` (contiene `planificacion.sqlite`).

## Estructura

```
server/index.js            API, sesiones, tiempo real, OAuth
server/calendar/http.js    cliente de solo lectura (GET)
server/calendar/google.js  Google Calendar (calendar.events.readonly)
server/calendar/microsoft.js  Microsoft 365 (Calendars.Read)
server/calendar/service.js caché por día + sondeo + avisos de cambios
server/db.js, seed.js      SQLite y datos iniciales del esquema
public/shared/planning.js  reglas: solapes, conductor, ausencias, sugerencias
public/js/app.js, dnd.js   interfaz y arrastrar y soltar (ratón y táctil)
```

## Pendiente de confirmar

- Perfil y color de **Alex, Jose Alm y Luis** (en blanco en el esquema).
- En el esquema hay una flecha de *TRAFIC 0824NLL* a *TRAFIC 0825NLL*. No se ha interpretado; las dos son fichas independientes.
- Al soltar una furgoneta sobre un trabajo que ya tiene una, se **sustituye** (una por trabajo). Para obras que
  necesitan dos furgonetas, se pueden marcar varias desde «Asignar…».
