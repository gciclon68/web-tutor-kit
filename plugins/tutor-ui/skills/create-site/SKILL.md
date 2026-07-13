---
name: create-site
description: Scaffold a browsable multi-page HTML site (left-nav modules + per-module page navigation + dark theme + resizable panels) with an embedded Claude Code "tutor" chat panel backed by a local Node bridge. Use when the user wants a study guide, interactive documentation, a course/module site, a reference site, or any local HTML presentation with a built-in AI chat that reads the site's context. Renders Markdown (tables) and LaTeX (matrices/formulas).
argument-hint: "[carpeta-destino] [tema del sitio]"
allowed-tools: Bash Read Write Edit Glob
---

# Crear un sitio multipágina con tutor de Claude Code

Scaffoldea el framework **Tutor UI** en el proyecto actual y lo adapta al tema que pida el usuario.

## Qué produce
Un sitio local, offline, con:
- **Panel izquierdo (25%, arrastrable)**: salta entre módulos.
- **Páginas navegables** dentro de cada módulo (panel derecho generado solo, botones ◀ ▶, flechas ← →). Una página a la vez, sin scroll infinito.
- **Tema oscuro por defecto** (toggle claro/oscuro, persistente).
- **Panel de chat "Tutor"** (ancho ajustable): habla con el CLI `claude` ya logueado (misma suscripción, sin API key) vía un bridge Node local; renderiza **Markdown completo (tablas)** + **LaTeX (matrices)**; **scrollbars ocultas** y un **riel de "dots"** (uno por pregunta) para saltar rápido entre prompts.
- **Lista de chats** en el panel izquierdo (debajo de "En este módulo"): **+ Nuevo**, cambiar y borrar; cada uno es su propia sesión de `claude` (persistida en `localStorage`), para manejar el contexto / abrir side-chats.
- **Encabezado del chat**: selector de **modelo** (Opus / Sonnet / Haiku / por defecto → pasa `--model`), botón **➕ Carpeta** para sumar una carpeta de contexto extra (además de RAW, vía `--add-dir`; se pega la ruta absoluta) y botón **📂 RAW** que abre esa carpeta en el explorador del SO (endpoint `/api/open`). Los títulos de los chats se autogeneran tipo *cheat-sheet* (≤5 palabras).
- **Carpeta `RAW/`**: el usuario deja ahí archivos extra (apuntes, enunciados, texto de PDFs) y el tutor los lee como contexto adicional, avisando cuándo los usa.
- Zonas del panel izquierdo con **altura fija + scroll interno** (barras ocultas), así no se estira con muchos módulos/páginas/chats.
- Scrollbars ocultas también en las páginas centrales (el scroll sigue con rueda/trackpad).
- Motor de canvas opcional (`plot.js`) para gráficos.

## Pasos

1. **Definí destino y tema.** Si el usuario no los dio, preguntá: nombre de la carpeta destino (default `tutor-site`) y de qué trata el sitio (título + módulos/páginas).

2. **Copiá la plantilla** al proyecto (NO edites la plantilla del plugin; copiala):
   ```bash
   TARGET="tutor-site"   # o el que pida el usuario
   mkdir -p "$TARGET"
   cp -r "${CLAUDE_PLUGIN_ROOT}/template/." "$TARGET/"
   ```
   Si `${CLAUDE_PLUGIN_ROOT}` no resuelve, la plantilla está en la carpeta `template/` de este plugin (dos niveles arriba de este SKILL.md).

3. **Adaptá el contenido** al tema del usuario:
   - `index.html`: título del sitio, textos del hero, y una tarjeta `.ecard` + un `<li>` en `.navlist` por cada módulo.
   - `1-modulo.html`: renombralo/duplicalo por módulo (`1-...`, `2-...`). Cada página es un `<article class="page" id="pN" data-label="0N" data-title="...">`. El panel derecho se llena solo desde esos atributos. Poné el acento del módulo con `style="--nav:var(--ltv)"` (`--ltv` ámbar, `--psi` violeta, `--phi` magenta, `--lti` teal).
   - Sumá los links de cada módulo en el panel izquierdo de **todas** las páginas.
   - Usá las clases del design system: `.card`, `.grid2`, `.callout`, `.eq` (fórmulas), `.steps`, `.readout`/`.rrow`, `.exam`. Para gráficos, el motor `PP` de `assets/plot.js` (`PP.register(canvas, drawFn)`).

4. **Llená `CONTEXTO.md`** con la info real del sitio (propósito, qué hay en cada página, datos/fórmulas que el tutor debe tratar como verdad). El tutor lo lee en cada primer mensaje.

5. **Referencia completa y trabajada:** mirá el ejemplo `${CLAUDE_PLUGIN_ROOT}/examples/espacio-estados/` — un sitio real (matriz fundamental y de transición, LTI/LTV) que usa todo el framework: sliders, retratos de fase en canvas, demostraciones paso a paso, tablas y LaTeX en el tutor. Copiá patrones de ahí.

6. **Verificá** levantando el sitio (si es posible) y probando navegación + una consulta al tutor. Ver la sección de ejecución.

## Cómo se ejecuta (decíselo al usuario)
- Solo lectura del sitio: doble clic en `index.html` (funciona en `file://`, sin tutor).
- Con tutor: `node chat-server.js` (o doble clic en `iniciar-tutor.cmd`; en mac/linux `./iniciar-tutor.sh`) y abrir **http://localhost:8770** — el tutor solo funciona servido por el bridge, no en `file://`.
- Requisitos: Node.js y el CLI `claude` instalado y logueado.

## Notas
- Todo es offline: `marked` y `MathJax` están vendorizados en `assets/vendor/`.
- El bridge escucha solo en `127.0.0.1` y habilita al CLI solo herramientas de lectura (`Read,Grep,Glob`).
- Configurable por entorno: `PORT` y `TUTOR_NAME` (ej: `TUTOR_NAME="Profe" PORT=9000 node chat-server.js`).
