# Guía — Publicador automático de Instagram (SEEDS)

Esta carpeta es un segundo proyecto, separado del dashboard. Su único trabajo es correr cada
15 minutos, gratis, revisando si hay algún posteo programado y publicándolo en Instagram
cuando llega su hora — aunque nadie tenga la app abierta.

Usa **GitHub Actions** (tareas programadas gratuitas de GitHub) para eso. Necesita 3 datos
secretos tuyos que **solo vos podés generar** (no puedo crearlos por vos porque requieren tu
login). Yo armé todo el código; a vos te toca la parte de cuentas y claves.

## Qué hay en esta carpeta

- `publish.js` — el script que busca posteos programados y los publica.
- `package.json` — sus dependencias.
- `.github/workflows/publish.yml` — la configuración de la tarea programada.

## Paso 1 — Ampliar el permiso de Instagram (publicar, no solo leer)

El token que ya tenés (en `config.js` del dashboard) solo sabe **leer** métricas. Para
**publicar** hace falta agregarle un permiso más:

1. Andá de nuevo a [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer).
2. Elegí la app **"Seeds Dashboard"**.
3. En "Agregar un permiso", sumá **`instagram_content_publishing`** (además de los 5 que ya
   tenías: `pages_show_list`, `pages_read_engagement`, `instagram_basic`,
   `instagram_manage_insights`, `business_management`).
4. Generá el token de usuario nuevo y pasámelo — yo hago el intercambio por el token de Página
   de larga duración, como la vez pasada. Este token nuevo reemplaza al anterior (en el
   `config.js` del dashboard) y además lo vamos a usar acá.

## Paso 2 — Generar la clave de Firebase (acceso de administrador a la base)

Este script necesita poder leer y escribir la base de datos sin depender de que alguien esté
logueado. Para eso usa una "clave de servicio", que tiene **acceso total** a tu base — mucho
más poder que cualquier otra clave que usamos hasta ahora. Tratala con cuidado.

1. Andá a [console.firebase.google.com](https://console.firebase.google.com) → tu proyecto
   → ⚙️ **Configuración del proyecto** → pestaña **Cuentas de servicio**.
2. Hacé clic en **"Generar nueva clave privada"** → confirmá → se descarga un archivo `.json`.
3. **No lo compartas, no lo subas a ningún lado, no me lo pegues en el chat.** Lo vas a pegar
   directo en GitHub en el paso 4 (campo de "Secret", que queda oculto para siempre, ni vos lo
   podés volver a ver después).

## Paso 3 — Crear el repositorio en GitHub

1. Andá a [github.com](https://github.com) y create una cuenta si no tenés (es gratis).
2. Botón **"New repository"** → nombre `seeds-publicador-instagram` → dejalo **público**
   (así las tareas programadas corren gratis sin límite; el código no tiene nada sensible, los
   datos secretos van aparte, en el paso 4) → "Create repository".
3. Avisame cuando lo hayas creado y pasame el link — yo subo el contenido de esta carpeta ahí
   (te voy a pedir confirmación antes de subir nada).

## Paso 4 — Cargar los 3 secretos

En el repositorio ya creado: **Settings > Secrets and variables > Actions > New repository
secret**. Creá estos tres, uno por uno:

| Nombre | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Todo el contenido del archivo `.json` del Paso 2 (abrilo con TextEdit, copiá todo, pegalo entero) |
| `IG_USER_ID` | `17841441955443896` |
| `IG_ACCESS_TOKEN` | El token nuevo del Paso 1 (con `instagram_content_publishing`) |

## Paso 5 — Probarlo

1. En el repositorio, pestaña **Actions** → vas a ver el workflow "Publicar posteos
   programados en Instagram" → botón **"Run workflow"** (lo corre ahora mismo, sin esperar
   los 15 minutos).
2. Programá un posteo de prueba desde el dashboard (con una foto real, fecha/hora en el
   pasado o dentro de los próximos minutos) y corré el workflow para ver si se publica.
3. Mirá el log de esa ejecución en GitHub — te dice si funcionó o qué error dio.

De ahí en más, corre solo cada 15 minutos sin que hagas nada.

## Notas importantes

- **No es publicación instantánea exacta**: como corre cada 15 minutos, un posteo programado
  para las 14:00 puede salir entre las 14:00 y las 14:15.
- **Videos/Reels** tardan más en procesarse del lado de Instagram — el script espera hasta
  2 minutos antes de rendirse; si falla por timeout, programalo de nuevo.
- **Si falla**, el posteo queda marcado "Falló la publicación" en el dashboard con el motivo,
  y no reintenta solo — hay que revisarlo y programarlo de nuevo a mano.
- **La clave de Firebase (Paso 2) y el token de Instagram (Paso 1) viven SOLO en GitHub
  Secrets** — nunca en el código, nunca en un archivo que se suba a ningún repo.
