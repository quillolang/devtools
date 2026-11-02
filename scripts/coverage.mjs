// Line coverage of extension/, from the V8 coverage files in a folder (Node's
// NODE_V8_COVERAGE, and the browser's, which tests/browser/coverage.mjs writes there).
//
//   node scripts/coverage.mjs .coverage
//
// A line with code on it (not blank, not only a comment) is covered when, in any of
// the runs, the innermost block around its first character ran.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = pathToFileURL(join(root, "extension")).href + "/";
const dir = process.argv[2] || ".coverage";

const byFile = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  for (const s of JSON.parse(readFileSync(join(dir, f), "utf8")).result || []) {
    if (!s.url.startsWith(ext)) continue;
    const ranges = s.functions.flatMap((fn) => fn.ranges);
    byFile.set(s.url, [...(byFile.get(s.url) || []), ranges]);
  }
}

// A file no run loaded counts too, every line of it not covered.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".js") ? [join(d, e.name)] : []));
for (const f of walk(join(root, "extension"))) if (!byFile.has(pathToFileURL(f).href)) byFile.set(pathToFileURL(f).href, []);

const rows = [];
let all = 0, hit = 0;
for (const [url, runs] of [...byFile].sort()) {
  const file = fileURLToPath(url);
  const lines = readFileSync(file, "utf8").split("\n");
  const missed = [];
  let code = 0, ok = 0, off = 0;
  lines.forEach((line, i) => {
    const t = line.trim();
    const at = off + line.length - line.trimStart().length;
    off += line.length + 1;
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    code++;
    const ran = runs.some((ranges) => {
      let best = null;
      for (const r of ranges) if (r.startOffset <= at && at < r.endOffset && (!best || r.endOffset - r.startOffset < best.endOffset - best.startOffset)) best = r;
      return best && best.count > 0;
    });
    if (ran) ok++; else missed.push(i + 1);
  });
  all += code;
  hit += ok;
  rows.push([relative(root, file), code, ok, missed]);
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(2) : "100.00");
const w = Math.max(...rows.map((r) => r[0].length), 5);
console.log(`${"file".padEnd(w)}  lines  covered       %  not covered`);
for (const [f, code, ok, missed] of rows) console.log(`${f.padEnd(w)}  ${String(code).padStart(5)}  ${String(ok).padStart(7)}  ${pct(ok, code).padStart(6)}  ${missed.join(", ")}`);
console.log(`${"total".padEnd(w)}  ${String(all).padStart(5)}  ${String(hit).padStart(7)}  ${pct(hit, all).padStart(6)}`);
