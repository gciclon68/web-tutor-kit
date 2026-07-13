# tutor-ui

Plugin de Claude Code para generar **sitios HTML multipágina con un tutor de IA embebido**.

## Qué incluye

- **`skills/create-site`** — skill que scaffoldea el framework en cualquier proyecto y lo adapta a tu tema. Invocable con `/tutor-ui:create-site` o automáticamente cuando pedís "un sitio de estudio / documentación / guía con chat".
- **`template/`** — el framework genérico que se copia a cada proyecto:
  - `assets/shell.css` — design system (tokens, layout de columnas, componentes) + tema claro/oscuro.
  - `assets/app.js` — navegación de páginas (panel derecho autogenerado, ◀ ▶, flechas ← →), tema **oscuro por defecto** y persistente, y **panel izquierdo arrastrable**.
  - `assets/tutor.js` — panel de chat flotante y **ajustable en ancho**; renderiza **Markdown (tablas)** y **LaTeX (matrices/fórmulas)** vía marked + MathJax; **scrollbars ocultas** + **riel de "dots"** para saltar entre preguntas.
  - **Lista de chats** (panel izquierdo): + Nuevo · cambiar · borrar; cada chat es su propia sesión `claude` en `localStorage` (para side-chats / manejo de contexto). Títulos auto tipo *cheat-sheet* (≤5 palabras).
  - **Encabezado del chat**: selector de modelo (`--model` Opus/Sonnet/Haiku), botón ➕ Carpeta de contexto extra (`--add-dir`) y 📂 RAW (abre la carpeta en el explorador vía `/api/open`).
  - `RAW/` — carpeta donde el usuario deja archivos extra; el tutor los lee como contexto adicional.
  - Zonas del panel izquierdo con altura fija + scroll interno (barras ocultas).
  - `assets/plot.js` — motor de canvas opcional (campo vectorial, integración RK4, ejes/retratos de fase).
  - `assets/vendor/` — `marked` + `MathJax tex-svg`, **offline** (sin CDNs).
  - `chat-server.js` — bridge Node: sirve el sitio y conecta el chat con el CLI `claude` (stdin → `claude -p --output-format json`, sesión con `--resume`). Escucha solo en `127.0.0.1`, herramientas de lectura únicamente.
  - `iniciar-tutor.cmd` / `iniciar-tutor.sh` — lanzadores.
  - `index.html`, `1-modulo.html`, `CONTEXTO.md` — plantillas de partida comentadas.
- **`examples/espacio-estados/`** — un sitio real y completo (matriz fundamental Ψ y de transición Φ, LTI vs LTV) que usa todo: sliders, retratos de fase, demostraciones paso a paso, tablas y LaTeX en el tutor. Úsalo como referencia.

## Cómo funciona el tutor

El HTML estático no puede lanzar Claude por sí solo, así que `chat-server.js` hace de puente:
el panel manda la pregunta a `/api/ask`, el server la pasa por **stdin** a `claude -p` corriendo
**en la carpeta del sitio** (así lee `CONTEXTO.md` y los `.html`), y devuelve la respuesta.
Usa tu login existente → **misma suscripción, sin API key**. Multi-turno vía `--resume`.

## Requisitos
- Node.js
- CLI `claude` (Claude Code) instalado y logueado.

## Personalización rápida
- Acentos de módulo con `--nav` (variables `--ltv` ámbar, `--psi` violeta, `--phi` magenta, `--lti` teal).
- Variables de entorno del bridge: `PORT`, `TUTOR_NAME`.
