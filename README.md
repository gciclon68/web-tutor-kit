# web-tutor-kit

Marketplace local de Claude Code con el plugin **tutor-ui**: sitios HTML multipágina
(navegación por módulos + tema oscuro + paneles ajustables) con un **panel de chat "Tutor"**
embebido que habla con tu CLI `claude` (misma suscripción, sin API key) y renderiza
**Markdown + LaTeX**. 100% offline.

## Instalar (una sola vez)

En cualquier sesión de Claude Code:

```
/plugin marketplace add D:\ClaudeRepo\web-tutor-kit
/plugin install tutor-ui@jolo-plugins
```

> `marketplace add` acepta una ruta local o una URL de git. Si más adelante subís esta
> carpeta a git, podés hacer `/plugin marketplace add <git-url>` desde cualquier máquina.

Para desarrollo/prueba sin instalar, también podés cargarlo suelto:
```
claude --plugin-dir D:\ClaudeRepo\web-tutor-kit\plugins\tutor-ui
```

## Usar

Ya instalado, en cualquier proyecto pedile a Claude algo como
*"armá un sitio de estudio con tutor sobre &lt;tu tema&gt;"* o invocá la skill directamente:

```
/tutor-ui:create-site  [carpeta-destino]  [tema]
```

Claude copia la plantilla, la adapta a tu tema y te dice cómo levantarla.

## Correr un sitio ya generado

```
cd <carpeta-del-sitio>
node chat-server.js          # o doble clic en iniciar-tutor.cmd  (./iniciar-tutor.sh en mac/linux)
```
Abrí **http://localhost:8770**. Requisitos: Node.js + CLI `claude` logueado.
(Para solo leer, sin tutor: doble clic en `index.html`.)

## Estructura

```
web-tutor-kit/
├── .claude-plugin/marketplace.json     # marketplace local
└── plugins/
    └── tutor-ui/
        ├── .claude-plugin/plugin.json
        ├── skills/create-site/SKILL.md # la skill que scaffoldea
        ├── template/                   # framework genérico (se copia a cada proyecto)
        │   ├── index.html · 1-modulo.html · CONTEXTO.md
        │   ├── chat-server.js · iniciar-tutor.cmd · iniciar-tutor.sh
        │   └── assets/ (shell.css, app.js, tutor.js, plot.js, vendor/)
        ├── examples/espacio-estados/   # ejemplo completo y funcionando
        └── README.md
```

MIT.
