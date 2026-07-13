# Contexto del sitio (para el Tutor de Claude Code)

> Este archivo lo lee el tutor embebido en cada primer mensaje. Llenalo con lo que
> quieras que Claude sepa sobre tu sitio: de qué trata, qué hay en cada página,
> datos/definiciones clave, y cualquier "fuente de verdad" que deba usar al responder.

## Qué es este sitio
(una o dos líneas describiendo el propósito y la audiencia)

## Estructura
```
index.html          Portada · panel izquierdo (25%) con los módulos
1-modulo.html       Módulo 1 · páginas P1, P2, P3…
CONTEXTO.md         este archivo
chat-server.js      bridge Node: sirve el sitio + conecta el panel con el CLI `claude`
iniciar-tutor.cmd   lanzador Windows (doble clic)
iniciar-tutor.sh    lanzador macOS/Linux
assets/
  shell.css   tokens de diseño + layout de columnas + componentes
  app.js      navegación de páginas, tema (dark por defecto), panel izquierdo arrastrable
  tutor.js    panel de chat flotante (Markdown + LaTeX) contra chat-server.js
  plot.js     motor de canvas opcional (campo vectorial, RK4, retratos de fase)
  vendor/     marked (Markdown) + MathJax tex-svg (LaTeX), 100% offline
```

## Cómo usar el tutor
```
node chat-server.js      # o doble clic en iniciar-tutor.cmd  (./iniciar-tutor.sh en mac/linux)
```
Abrí **http://localhost:8770** (no `file://`). Botón **Tutor** abajo a la derecha.
Usa tu CLI `claude` ya logueado → misma suscripción, sin API key. El chat renderiza
Markdown (tablas, listas) y LaTeX (fórmulas y matrices).

## Datos / definiciones clave
(pegá acá lo que el tutor deba tratar como verdad: fórmulas verificadas, glosario,
convenciones, decisiones, etc. Cuanto más concreto, mejores respuestas.)
