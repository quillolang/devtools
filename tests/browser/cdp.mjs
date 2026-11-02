// Chrome over the DevTools protocol, through --remote-debugging-pipe, with nothing
// to install. Chrome 137 and later take no --load-extension, so the extension is
// loaded with the protocol's Extensions.loadUnpacked, which wants the pipe.
//
//   const chrome = await launch({ extension: "extension" })
//   const page = await chrome.page("http://127.0.0.1:8080/")
//   await page.send("Runtime.evaluate", { expression: "1 + 1" })
//   chrome.close()

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { begin, take, write } from "./coverage.mjs";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

export const findChrome = () => process.env.CHROME || CANDIDATES.find((p) => existsSync(p)) || null;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits until `f` gives something truthy, and gives it; fails after `ms`.
export async function until(f, ms = 5000, what = "the condition") {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    last = await f();
    if (last) return last;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

export async function launch({ extension, width = 1200, height = 800 } = {}) {
  const path = findChrome();
  if (!path) throw new Error("no Chrome found: set CHROME");
  const profile = mkdtempSync(join(tmpdir(), "quillo-devtools-"));
  const proc = spawn(path, ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", `--window-size=${width},${height}`,
    // CHROME_FLAGS: Chrome's own, as a CI machine may need (--no-sandbox).
    ...(process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean), "about:blank"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  // A command still being written when Chrome is closed has nowhere to go.
  proc.stdio[3].on("error", () => {});
  let next = 0, buf = "";
  const waiting = new Map();
  const listeners = new Map();
  proc.stdio[4].on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\0")) >= 0;) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.id && waiting.has(m.id)) {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) w.no(Object.assign(new Error(`${w.method}: ${m.error.message}`), { cdp: m.error })); else w.ok(m.result);
      } else if (m.method) {
        for (const f of listeners.get(`${m.sessionId || ""}:${m.method}`) || []) f(m.params);
      }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = ++next;
    waiting.set(id, { ok, no, method });
    proc.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
  const on = (sessionId, method, f) => {
    const k = `${sessionId || ""}:${method}`;
    listeners.set(k, [...(listeners.get(k) || []), f]);
  };
  let extensionId = null;
  const pages = [];
  if (extension) extensionId = (await send("Extensions.loadUnpacked", { path: resolve(extension) })).id;

  // What a tab has run of the extension, written (with coverage on).
  async function flush(p) {
    if (!extension || !pages.includes(p)) return;
    try { write(await take(p, extensionId, resolve(extension))); } catch (e) { process.stderr.write(`coverage: ${e.message}\n`); }
  }

  // A tab, attached: `send`, `on`, `evaluate`, the execution contexts it has made
  // (each { id, name, origin, auxData }), and `go(url)`, which waits for the load.
  async function page(url = "about:blank") {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const p = {
      targetId,
      sessionId,
      contexts: [],
      send: (method, params) => send(method, params, sessionId),
      on: (method, f) => on(sessionId, method, f),
      async evaluate(expression, opts = {}) {
        const r = await p.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...opts });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
        return r.result.value;
      },
      async go(to) {
        // What the document ran goes with it: written first.
        await flush(p);
        const loaded = new Promise((r) => {
          const f = () => { r(); f.done = true; };
          on(sessionId, "Page.loadEventFired", () => { if (!f.done) f(); });
        });
        await p.send("Page.navigate", { url: to });
        await Promise.race([loaded, sleep(10000)]);
      },
    };
    p.on("Runtime.executionContextCreated", ({ context }) => p.contexts.push(context));
    p.on("Runtime.executionContextsCleared", () => { p.contexts.length = 0; });
    await p.send("Runtime.enable");
    await p.send("Page.enable");
    await begin(p);
    pages.push(p);
    if (url !== "about:blank") await p.go(url);
    return p;
  }

  return {
    extensionId,
    send,
    page,
    // Closes a tab, first writing what it ran of the extension (with coverage on).
    async closePage(p) {
      await flush(p);
      pages.splice(pages.indexOf(p), 1);
      await send("Target.closeTarget", { targetId: p.targetId });
    },
    // Closes Chrome, first writing what each tab ran of the extension, when
    // coverage is being taken (NODE_V8_COVERAGE).
    async close() {
      for (const p of pages) await flush(p);
      proc.kill();
      try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    },
  };
}
