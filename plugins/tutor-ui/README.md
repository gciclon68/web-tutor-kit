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
  - `chat-server.js` — bridge Node: sirve el sitio, expone `/api/ask`, `/api/health` y `/api/open`.
  - `lib/` — `config.js` (config por capas + wizard), `context.js` (contexto del sitio para el modo API) y `providers/{cli,api}.js`. **Cero dependencias**: no hace falta `npm install`.
  - `iniciar-tutor.cmd` / `iniciar-tutor.sh` — lanzadores.
  - `index.html`, `1-modulo.html`, `CONTEXTO.md` — plantillas de partida comentadas.
- **`examples/espacio-estados/`** — un sitio real y completo (matriz fundamental Ψ y de transición Φ, LTI vs LTV) que usa todo: sliders, retratos de fase, demostraciones paso a paso, tablas y LaTeX en el tutor. Úsalo como referencia.
- **`test/`** — suite con `node --test` (51 tests). Correla con `node --test "plugins/tutor-ui/test/*.test.js"`.

## Cómo funciona el tutor

El HTML estático no puede lanzar Claude por sí solo, así que `chat-server.js` hace de puente.
Hay **dos modos**, y elegís uno la primera vez:

| | **CLI** (recomendado) | **API** |
|---|---|---|
| Cómo habla | `claude -p --output-format json` por stdin, corriendo en la carpeta del sitio | `POST {baseUrl}/v1/messages` |
| Credencial | tu login existente — **misma suscripción, sin API key** | API key de Anthropic |
| Cómo ve el sitio | el CLI lee los archivos solo (`Read,Grep,Glob`) | `lib/context.js` le inyecta `CONTEXTO.md` + la página actual + `RAW/` |
| Sesiones | persisten en `~/.claude/projects/` | **en memoria** — se pierden si reiniciás el server |
| Costo | incluido en la suscripción | **se cobra por mensaje** |

El `baseUrl` del modo API es configurable, así que también sirve para un gateway corporativo
o un proxy tipo LiteLLM que hable la Messages API.

## Configuración (una sola vez por computadora)

La primera vez, `node chat-server.js` te pregunta el modo y guarda la respuesta en
`~/.tutor-ui/config.json`. No vuelve a preguntar.

```json
{
  "version": 1,
  "provider": "cli",
  "cli":  { "bin": "C:\\Users\\vos\\...\\claude.cmd" },
  "api":  { "baseUrl": "https://api.anthropic.com",
            "keyEnv": "ANTHROPIC_API_KEY", "key": null },
  "models": { "opus": "claude-opus-5", "sonnet": "claude-sonnet-5",
              "haiku": "claude-haiku-4-5-20251001", "default": "sonnet" },
  "port": 8770,
  "openBrowser": true
}
```

Orden de precedencia (gana el primero): **flags** → **entorno**
(`TUTOR_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `PORT`, `TUTOR_NAME`) →
`<sitio>/tutor.config.json` → `~/.tutor-ui/config.json` → defaults.

**La API key**: por defecto se lee de la variable de entorno y **no se guarda en disco**.
Si preferís pegarla en el wizard, queda en `~/.tutor-ui/config.json` con permisos `0600`
y el wizard te avisa. Nunca se escribe en el `tutor.config.json` del sitio.

## Arrancarlo

```bash
node chat-server.js                  # arranca (pregunta la primera vez)
node chat-server.js --reconfigure    # volver a preguntar
node chat-server.js --port 9000      # forzar puerto
node chat-server.js --no-open        # no abrir el navegador
```

Si el puerto está ocupado, sube solo (hasta +10) e imprime el link **real**:

```
  ✅ Tutor listo · CLI · claude-sonnet-5

     👉  http://localhost:8771
```

## Que el chat funcione, garantizado

- **Arranque con gate**: si el CLI no está o falta la key, el server no levanta y te dice
  exactamente qué arreglar.
- **Chequeo profundo en segundo plano**: detecta "instalado pero no logueado" y "key
  inválida" sin demorar el arranque. El panel muestra un pill: ⚪ probando → 🟢 listo / 🔴 error
  (clic en rojo = reintentar).
- **`file://`**: si abrís `index.html` con doble clic, el panel muestra una tarjeta con los
  pasos para arrancar el bridge en vez de fallar callado. El resto del sitio funciona igual.

## Requisitos
- **Node.js 18+**
- CLI `claude` logueado (modo CLI) **o** una API key de Anthropic (modo API).

## Personalización rápida
- Acentos de módulo con `--nav` (variables `--ltv` ámbar, `--psi` violeta, `--phi` magenta, `--lti` teal).
- Nombre del tutor: `TUTOR_NAME="Profe" node chat-server.js`.
