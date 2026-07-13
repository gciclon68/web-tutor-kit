# Espacio de Estados — contexto para Claude Code

Guía de estudio interactiva sobre **matriz fundamental (Ψ)** y **matriz de transición de estados (Φ)** en sistemas lineales, con foco en el paso **LTI → LTV** (cuando A deja de ser constante y pasa a depender del tiempo). Sistema-ancla: **masa–resorte–amortiguador**.

## Cómo pedirle ayuda a Claude Code sobre esto

La forma más efectiva (y la que respondés en tu punto 3):

1. **Abrí una sesión de Claude Code dentro de `D:\ClaudeRepo\DinamicaOco`** (ya estás en el proyecto). Claude lee estos archivos directamente, así que tenés contexto perfecto sin copiar/pegar.
2. **Referenciá por archivo y página**, por ejemplo:
   - "En `3-transicion.html`, página 3 (por qué falla e^∫A), no me cierra el conmutador."
   - "Explicame el paso 3 del armado de Ψ en `2-fundamental.html` página 5."
3. Este `CONTEXTO.md` resume la matemática, así que podés decir "mirá CONTEXTO.md" para anclar cualquier pregunta.

> No existe una "superficie de Claude Code embebida dentro de un artifact". Trabajar con estos **archivos locales en el proyecto** es la mejor manera de tener a Claude con contexto completo.

### Tutor embebido en el sitio (panel de chat)

El sitio tiene un **panel de chat "Tutor Claude Code"** (botón abajo a la derecha) que habla con tu CLI `claude` ya logueado — **misma suscripción, sin API key**. Un HTML estático no puede lanzar Claude por sí solo, así que hay un bridge en Node.

**Para usarlo:**
```
cd D:\ClaudeRepo\DinamicaOco\espacio-estados
node chat-server.js
```
Luego abrí **http://localhost:8770** (no `file://`). El botón "Tutor Claude Code" abre el chat; cada pregunta corre `claude -p` en esta carpeta con el contexto de la guía, y las conversaciones mantienen la sesión (`--resume`) mientras la pestaña siga abierta.

- Sin el server corriendo, el sitio se ve igual pero el panel avisa que arranques el bridge.
- El bridge escucha solo en `127.0.0.1` (local), permite solo herramientas de lectura (`Read,Grep,Glob`) y pasa tu mensaje por stdin.

## Estructura de archivos

```
espacio-estados/
├── index.html          Portada · panel izquierdo (25%) con los 3 módulos
├── 1-conceptual.html   Módulo 1 · 6 páginas (física → álgebra, Ψ, Φ, plano de fases, LTI→LTV)
├── 2-fundamental.html  Módulo 2 · 6 páginas (constructor Ψ, Ejercicio 2 a/b/c, Ψ del Ej.3)
├── 3-transicion.html   Módulo 3 · 7 páginas (propiedades Φ, e^Aτ, falla de e^∫A, Peano–Baker, Ej.3 a/b)
├── CONTEXTO.md         este archivo
├── chat-server.js      bridge Node: sirve el sitio + conecta el panel con el CLI `claude`
└── assets/
    ├── shell.css       tokens de diseño + layout de 3 columnas + componentes
    ├── plot.js         motor de canvas (PP): campo vectorial, RK4, retratos de fase
    ├── app.js          navegación de páginas (panel derecho), Prev/Next, flechas ←→, tema (dark por defecto)
    └── tutor.js        panel de chat flotante que consulta a `claude` vía chat-server.js
```

Navegación: panel **izquierdo** = módulos; panel **derecho** = páginas dentro del módulo; teclas **← →** o botones **◀ ▶**. Una página a la vez. Tema claro/oscuro con el botón "◐ tema". Todo funciona offline (sin CDNs).

## Resumen matemático (fuente de verdad)

### Sistema-ancla LTI: masa–resorte–amortiguador
`m·ẍ + c·ẋ + k·x = 0`. Estado `x = [posición, velocidad]`.
```
A = [[0, 1], [-k/m, -c/m]]
```
Autovalores λ = (T ± √(T²−4D))/2 con T = −c/m (traza), D = k/m (det). Re(λ) → crece/decae; Im(λ) → oscila. Espiral (subamortiguado), centro (c=0), nodo (sobreamortiguado), silla (inestable).

### Ejercicio 2 (demostraciones)
- **2·a** — αΨ₁+βΨ₂ es solución: `(αΨ₁+βΨ₂)′ = αAΨ₁+βAΨ₂ = A(αΨ₁+βΨ₂)`.
- **2·b** — solución pero **no** necesariamente fundamental: el determinante puede anularse (ej. det(αΨ₁+βΨ₂)=α²−β², cero si α=±β). Fundamental exige det ≠ 0 ∀t.
- **2·c** — Φ=ΨM con M invertible **constante** es fundamental: `Φ′=Ψ′M=AΨM=AΦ` (solución) y `det Φ=det Ψ·det M ≠ 0`. Con M=Ψ(t₀)⁻¹ → Φ(t,t₀).

### Ejercicio 3 — sistema VARIANTE en el tiempo (LTV)
```
A(t) = [[2, e^(-t)], [0, 1]]   →   ẋ₁ = 2x₁ + e^(-t) x₂ ,  ẋ₂ = x₂
```
Triangular superior → integración directa por componentes (abajo→arriba):
- `x₂ = c₂ e^t`
- `ẋ₁ − 2x₁ = c₂` → `x₁ = c₁ e^(2t) − c₂/2`
- Soluciones base: `[e^(2t), 0]ᵀ` y `[−1/2, e^t]ᵀ`.

**Matriz fundamental:**
```
Ψ(t) = [[e^(2t), -1/2], [0, e^t]]        Wronskiano det Ψ = e^(3t) ≠ 0  (Abel: tr A = 3)
```

**Ejercicio 3·a — matriz de transición Φ(t,0)** (normalizar: Ψ(0)=[[1,−1/2],[0,1]], Ψ(0)⁻¹=[[1,1/2],[0,1]]):
```
Φ(t,0) = Ψ(t)·Ψ(0)⁻¹ = [[e^(2t), (e^(2t)-1)/2], [0, e^t]]
```
Verificado: Φ(0)=I y Φ′=AΦ (fila 1 col 2 de AΦ = 2·(e^(2t)−1)/2 + e^(-t)·e^t = e^(2t) ✓).

**Ejercicio 3·b — PVI con x(0)=[0,1]ᵀ:**
```
x(t) = Φ(t,0)·[0,1]ᵀ = [ (e^(2t)-1)/2 , e^t ]ᵀ
```

### Por qué e^(∫A) FALLA en LTV (el punto central)
Solo vale `Φ = e^(∫A)` si A(t) conmuta en tiempos distintos: A(t₁)A(t₂)=A(t₂)A(t₁) ∀ t₁,t₂.
Para esta A: `[A(t₁),A(t₂)]₁₂ = e^(-t₂) − e^(-t₁) ≠ 0` → **no conmuta**.
Comprobación numérica (esquina ₁₂, t=1): Φ real = (e²−1)/2 ≈ **3.195**; e^(∫A) ingenuo = (1−e⁻¹)(e²−e)/1 ≈ **2.952** (~7.6% de error). Método general correcto: **serie de Peano–Baker**.

### Métodos para Φ (árbol de decisión de examen)
1. A constante → `e^(A(t−t₀))` (autovalores / serie / diagonalización).
2. A(t) triangular o desacoplada → integración directa por componentes (Ejercicio 3).
3. Caso general → serie de Peano–Baker; `e^(∫A)` solo si A conmuta ∀t.
Verificación universal: `Φ(t₀)=I` y `Φ′=A(t)Φ`.
