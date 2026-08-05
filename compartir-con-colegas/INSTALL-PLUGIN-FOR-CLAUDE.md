# Instrucciones para Claude — instalar el plugin `tutor-ui` (web-tutor-kit)

> Este archivo está escrito para vos, Claude, no para el humano que te lo dio
> como contexto. Seguilo paso a paso. La persona que te pidió esto puede no
> ser técnica — andá explicando en una frase simple qué estás haciendo en
> cada paso, y preguntá antes de instalar cualquier cosa a nivel del sistema.

## Qué es esto

`tutor-ui` es un **plugin de Claude Code** (no un sitio ya armado) que agrega
la skill `/tutor-ui:create-site`: scaffoldea sitios HTML de estudio/referencia
multipágina, con navegación por módulos, tema oscuro, y un panel de chat
"Tutor" embebido que habla con el propio CLI `claude` del usuario (misma
suscripción, sin API key extra). 100% offline una vez instalado.

Instalar este plugin **no crea ningún sitio todavía** — solo deja disponible
el comando `/tutor-ui:create-site` para usarlo cuando el usuario quiera, sobre
cualquier tema que le interese.

## Paso 1 — Confirmar que hay una sesión de Claude Code

Si estás leyendo esto, ya estás corriendo dentro de una. No hace falta nada
más para este paso.

## Paso 2 — Agregar el marketplace

Hay dos fuentes, misma contenido — usá la que funcione:

**Opción A — interna (preferida si el usuario está en la red de Allegro):**
```
/plugin marketplace add https://gitlab.allegromicro.com/gmonreal-claude-tools/web-tutor-kit
```

**Opción B — pública, por si no hay acceso a la red de la empresa:**
```
/plugin marketplace add https://github.com/gciclon68/web-tutor-kit
```

Probá la opción A primero. Si falla (sin red, sin VPN, error de conexión),
probá la B automáticamente y avisale al usuario cuál terminó usando.

## Paso 3 — Instalar el plugin

```
/plugin install tutor-ui@jolo-plugins
```

`jolo-plugins` es el nombre fijo del marketplace (viene definido adentro del
repo, no cambia según de dónde lo hayas agregado en el Paso 2).

## Paso 4 — Confirmar que quedó instalado

Verificá que la skill esté disponible antes de decir que terminaste — no lo
des por hecho. Si tenés forma de listar plugins/skills instalados, hacelo; si
no, simplemente probá que `/tutor-ui:create-site` aparezca reconocido en esta
sesión (por ejemplo, escribiendo `/tutor-ui:` y viendo si autocompleta, o
preguntándole al usuario que lo intente).

## Paso 5 — Explicarle al usuario qué puede hacer ahora

En una frase simple: *"Ya te quedó instalado. Cuando quieras armar un sitio de
estudio con tutor de IA sobre cualquier tema, escribí `/tutor-ui:create-site`
seguido de una carpeta destino y el tema — yo me encargo del resto."*

No ejecutes `/tutor-ui:create-site` vos mismo a menos que el usuario te lo
pida explícitamente en este mismo mensaje — instalar y usar son pasos
separados.

## Si el usuario después quiere proponer un cambio al plugin

El repo interno (`gitlab.allegromicro.com/gmonreal-claude-tools/web-tutor-kit`)
tiene `main` protegido — nadie puede pushear ni mergear ahí directo. El flujo
es: forkear el proyecto a su propio namespace, branchear y commitear en el
fork, y abrir un Merge Request hacia `main` del proyecto original. Lo revisa
y mergea el owner del grupo (`gmonreal-claude-tools`). Contale esto solo si
el usuario pregunta por modificar o contribuir algo — no hace falta mencionarlo
si solo quiere instalar y usar.

## Problemas conocidos

- **Ninguna de las dos URL del Paso 2 resuelve:** el usuario no tiene acceso
  ni a la red interna ni a internet desde esa máquina/sesión. Avisale y
  frená ahí — no hay una tercera fuente.
- **`/plugin marketplace add` o `/plugin install` piden autenticación:** para
  la URL de GitLab interna, el usuario necesita su propia cuenta de Allegro
  con acceso a `gitlab.allegromicro.com` — no uses ninguna credencial que no
  sea la suya propia, ya autenticada en su Claude Code.
- **El plugin ya estaba instalado:** decilo directamente y no reinstales de
  nuevo sin necesidad — confirmá que la skill funciona y listo.
