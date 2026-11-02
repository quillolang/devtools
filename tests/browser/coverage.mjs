// What the browser ran of the extension's files, as V8 reports it, written beside
// Node's own (NODE_V8_COVERAGE) so that scripts/coverage.mjs counts both together.
//
// Chrome names the extension's scripts chrome-extension://<id>/<path>: they become
// the files' own file:// URLs. lib/page.js's functions run in the page as text the
// panel sends, `(function scan() {...})(args)`, which Chrome names nothing: each is
// found in page.js by its text, and its ranges moved to where it stands there.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ON = !!process.env.NODE_V8_COVERAGE;

// Starts counting in a tab, before it loads anything.
export async function begin(p) {
  if (!ON) return;
  p.scripts = new Map();
  p.on("Debugger.scriptParsed", ({ scriptId, url }) => p.scripts.set(scriptId, url));
  await p.send("Debugger.enable");
  await p.send("Profiler.enable");
  await p.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
}

// What a tab ran, as V8's ScriptCoverage entries for the extension's files.
export async function take(p, extensionId, extDir) {
  if (!ON || !p.scripts) return [];
  const { result } = await p.send("Profiler.takePreciseCoverage");
  const prefix = `chrome-extension://${extensionId}/`;
  const pageFile = join(extDir, "lib", "page.js");
  const pageSrc = readFileSync(pageFile, "utf8");
  const out = [];
  for (const s of result) {
    const url = s.url || p.scripts.get(s.scriptId) || "";
    if (url.startsWith(prefix)) {
      out.push({ ...s, url: pathToFileURL(join(extDir, url.slice(prefix.length).split("?")[0])).href });
      continue;
    }
    if (url !== "") continue;
    let src;
    try { src = (await p.send("Debugger.getScriptSource", { scriptId: s.scriptId })).scriptSource; } catch (_) { continue; }
    if (!src.startsWith("(function ")) continue;
    const text = src.slice(1, src.lastIndexOf(")("));
    const at = pageSrc.indexOf(text);
    if (at < 0) continue;
    const shift = at - 1, end = at + text.length;
    const move = (r) => ({ ...r, startOffset: Math.max(at, r.startOffset + shift), endOffset: Math.min(end, r.endOffset + shift) });
    out.push({ scriptId: s.scriptId, url: pathToFileURL(pageFile).href, functions: s.functions.map((f) => ({ ...f, ranges: f.ranges.map(move) })) });
  }
  return out;
}

let n = 0;
export function write(entries) {
  if (!ON || !entries.length) return;
  mkdirSync(process.env.NODE_V8_COVERAGE, { recursive: true });
  writeFileSync(join(process.env.NODE_V8_COVERAGE, `coverage-browser-${process.pid}-${++n}.json`), JSON.stringify({ result: entries }));
}
