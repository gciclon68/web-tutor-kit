const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ctx = require("../template/lib/context.js");

function tmpSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-"));
  for (const [rel, content] of Object.entries(files)) {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  return dir;
}

test("htmlToText strips scripts, styles and tags", () => {
  const t = ctx.htmlToText(
    "<style>a{color:red}</style><script>var x=1</script><h1>T&iacute;tulo</h1><p>Hola <b>ah&iacute;</b></p>");
  assert.ok(!t.includes("color:red"));
  assert.ok(!t.includes("var x"));
  assert.ok(t.includes("Hola"));
  assert.ok(t.includes("ahí"));
});

test("htmlToText decodes numeric and named entities", () => {
  const t = ctx.htmlToText("<p>a &amp; b &lt;c&gt; &#233; &nbsp;fin</p>");
  assert.ok(t.includes("a & b"));
  assert.ok(t.includes("<c>"));
  assert.ok(t.includes("é"));
});

test("gather includes CONTEXTO.md when present", () => {
  const dir = tmpSite({ "CONTEXTO.md": "El sitio trata de matrices." });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [] });
  assert.ok(r.text.includes("El sitio trata de matrices."));
  assert.deepEqual(r.truncated, []);
});

test("gather survives a missing CONTEXTO.md and missing RAW", () => {
  const dir = tmpSite({ "index.html": "<h1>hola</h1>" });
  const r = ctx.gather({ siteDir: dir, page: "/index.html", extraDirs: [] });
  assert.ok(r.text.includes("hola"));
});

test("gather reads the page named by `page`", () => {
  const dir = tmpSite({ "1-modulo.html": "<article>contenido del modulo uno</article>" });
  const r = ctx.gather({ siteDir: dir, page: "/1-modulo.html", extraDirs: [] });
  assert.ok(r.text.includes("contenido del modulo uno"));
});

test("gather refuses to escape the site directory", () => {
  const dir = tmpSite({ "index.html": "<p>ok</p>" });
  const r = ctx.gather({ siteDir: dir, page: "/../../etc/passwd", extraDirs: [] });
  assert.ok(!r.text.includes("root:"));
});

test("CONTEXTO.md over its cap is truncated and reported", () => {
  const dir = tmpSite({ "CONTEXTO.md": "x".repeat(ctx.CAPS.contexto + 5000) });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [] });
  assert.ok(r.truncated.some(s => s.includes("CONTEXTO.md")));
  assert.ok(r.text.length <= ctx.CAPS.total + 4096);
});

test("RAW files are listed with heads", () => {
  const dir = tmpSite({ "RAW/apuntes.md": "teorema fundamental",
                        "RAW/foto.png": "PIXELES-NO-DEBEN-APARECER" });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [] });
  assert.ok(r.text.includes("apuntes.md"));
  assert.ok(r.text.includes("teorema fundamental"));
  assert.ok(r.text.includes("foto.png"));
  assert.ok(!r.text.includes("PIXELES-NO-DEBEN-APARECER"));
});

test("extraDirs contribute filenames only, never contents", () => {
  const extra = tmpSite({ "secreto.md": "NO-DEBE-APARECER" });
  const dir = tmpSite({ "index.html": "<p>ok</p>" });
  const r = ctx.gather({ siteDir: dir, page: "/", extraDirs: [extra] });
  assert.ok(r.text.includes("secreto.md"));
  assert.ok(!r.text.includes("NO-DEBE-APARECER"));
});

test("total never exceeds the hard cap", () => {
  const big = "y".repeat(30000);
  const dir = tmpSite({ "CONTEXTO.md": big, "index.html": "<p>" + big + "</p>",
                        "RAW/a.md": big, "RAW/b.md": big });
  const r = ctx.gather({ siteDir: dir, page: "/index.html", extraDirs: [] });
  assert.ok(r.text.length <= ctx.CAPS.total + 4096);
});

test("a nonexistent extraDir is skipped silently", () => {
  const dir = tmpSite({ "index.html": "<p>ok</p>" });
  const r = ctx.gather({ siteDir: dir, page: "/",
                         extraDirs: [path.join(os.tmpdir(), "no-existe-jamas-xyz")] });
  assert.ok(r.text.length > 0);
});
