// The extension in Chrome, on the fixture app run by Quillo, in production and under
// --watch. What it checks:
//
// - the content scripts: errors and Quillo's sockets heard, on Quillo's pages only;
// - lib/page.js in the page: islands listed, highlighted, the Elements pane's reading;
// - lib/state.js through a protocol session (the extension's chrome.debugger): state
//   read as it is now, and set;
// - the panel, opened as a page of the extension's with chrome.devtools stood in for
//   (DevTools itself does not run headless): what it shows, with the real
//   chrome.debugger for "Current state". A screenshot of each tab goes in tests/out/.
//
//   QUILLO_BIN=/path/to/quillo node --test tests/browser/

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, until, sleep, findChrome } from "./cdp.mjs";
import { start, quilloVersion } from "./quillo.mjs";
import { call, scan, island, highlight, selected } from "../../extension/lib/page.js";
import { readState, setState } from "../../extension/lib/state.js";
import { describe as describeFrame } from "../../extension/lib/live.js";

const here = dirname(fileURLToPath(import.meta.url));
const EXT = join(here, "..", "..", "extension");
const OUT = join(here, "..", "out");
const NAME = "Quillo DevTools";

const skip = !findChrome() ? "no Chrome (set CHROME)" : !quilloVersion() ? "no quillo (set QUILLO_BIN)" : false;

const isolated = (p) => p.contexts.filter((c) => c.auxData && c.auxData.type === "isolated" && c.name === NAME).pop();
const heard = async (p, after = 0) => p.evaluate(`__quilloDevtools.since(${after})`, { contextId: isolated(p).id });
const click = (p, sel) => p.evaluate(`document.querySelector(${JSON.stringify(sel)}).click()`);
const rpc = (url, name, args) => fetch(`${url}/_quillo/rpc/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) }).then((r) => r.json());

for (const watch of [false, true]) {
  describe(watch ? "under --watch" : "in production", { skip }, () => {
    let app, chrome, page;
    before(async () => {
      // Production with --describe, so that the Server tab lists the API, and with
      // --no-wt, so that channels go over a WebSocket; --watch with WebTransport.
      app = await start({ watch, describe: !watch, args: watch ? [] : ["--no-wt"] });
      chrome = await launch({ extension: EXT });
      page = await chrome.page(app.url + "/");
      await until(() => page.evaluate("!!window.__quillo_booted"), 8000, "Quillo to start");
    });
    after(async () => { if (chrome) await chrome.close(); if (app) app.stop(); });

    test("the content scripts run, and make Quillo's error list on its pages only", async () => {
      assert.ok(isolated(page), "the bridge's world");
      assert.equal(await page.evaluate("Object.prototype.hasOwnProperty.call(window.__quilloErrors, 'push')"), true);
      const h = await heard(page);
      assert.ok(h.events.some((e) => e.kind === "page"));
      assert.equal(typeof h.doc, "string");
      const plain = await chrome.page(app.url + "/plain");
      await sleep(200);
      // A page with no component: Quillo's, but nothing of it runs, so no error list.
      // Under --watch it still listens for the program changing.
      assert.equal(await plain.evaluate("'__quilloErrors' in window"), false);
      assert.deepEqual((await heard(plain)).events.map((e) => [e.kind, e.path]), watch ? [["ws-open", "/_quillo/events"]] : []);
      const s = await plain.evaluate(call(scan));
      assert.deepEqual([s.quillo, s.islands.length, s.dev], [true, 0, watch]);
      const blank = await chrome.page("data:text/html,<p>not Quillo</p>");
      assert.equal((await blank.evaluate(call(scan))).quillo, false);
    });

    test("scan lists the islands, nested, with what the server wrote", async () => {
      const s = await page.evaluate(call(scan));
      assert.equal(s.quillo, true);
      assert.equal(s.dev, watch);
      assert.equal(s.booted, true);
      assert.deepEqual(s.islands.map((x) => [x.name, x.depth, x.parent]), [["Counter", 0, -1], ["Inner", 1, 0], ["Counter", 0, -1], ["Inner", 1, 2]]);
      assert.ok(s.islands.every((x) => x.resumed && x.server));
      assert.deepEqual(s.islands.map((x) => x.live), [true, false, true, false]);
      assert.ok(s.globals.includes("__quillo_booted"));
      const first = await page.evaluate(call(island, 0));
      assert.equal(JSON.parse(first.state).n, 3);
      assert.deepEqual(JSON.parse(first.props), { start: 3, label: "clicks" });
      assert.equal(JSON.parse(first.live).items.f, "list_tasks");
      // An island inside another is written with no props: its outer one passes them.
      assert.equal((await page.evaluate(call(island, 1))).props, "{}");
      assert.equal(await page.evaluate(call(island, 99)), null);
    });

    test("highlight boxes an island and takes the box away", async () => {
      assert.equal(await page.evaluate(call(highlight, 0)), true);
      const box = await page.evaluate("(() => { const b = document.getElementById('quillo-devtools-highlight'); return b && [b.textContent, parseFloat(b.style.width) > 0]; })()");
      assert.match(box[0], /^<Counter> {2}\d+ × \d+$/);
      assert.equal(box[1], true);
      assert.equal(await page.evaluate(call(highlight, 1)), true);
      assert.equal(await page.evaluate("document.querySelectorAll('#quillo-devtools-highlight').length"), 1);
      assert.equal(await page.evaluate(call(highlight, -1)), false);
      assert.equal(await page.evaluate("document.getElementById('quillo-devtools-highlight')"), null);
    });

    test("the Elements pane reads the island an element is in", async () => {
      const inner = await page.evaluate(`(${selected.toString()})(document.querySelector("p.inner").firstChild)`);
      assert.equal(inner.component, "Inner");
      assert.equal(inner.inside, "Counter");
      assert.match(inner.status, /^running/);
      const outside = await page.evaluate(`(${selected.toString()})(document.body)`);
      assert.equal(outside.component, null);
    });

    test("an error Quillo catches is heard, as it says it", async () => {
      const before = (await heard(page)).last;
      await click(page, "button.boom");
      const h = await until(async () => { const x = await heard(page, before); return x.events.some((e) => e.kind === "error") && x; }, 3000, "the error");
      assert.equal(h.events.find((e) => e.kind === "error").message, "cannot add null and int");
      assert.ok((await page.evaluate(call(scan))).counts.errors >= 1);
    });

    test("live updates are heard: what the page follows and what changed", async () => {
      const h0 = await heard(page);
      const open = h0.events.find((e) => e.kind === "ws-open" && e.path === "/_quillo/live");
      assert.ok(open, "the live socket");
      assert.deepEqual(describeFrame(open).topics, ["db:tasks"]);
      if (watch) assert.ok(h0.events.some((e) => e.kind === "ws-open" && e.path === "/_quillo/events"));
      await rpc(app.url, "add_task", ["from outside"]);
      const h = await until(async () => { const x = await heard(page, h0.last); return x.events.some((e) => e.kind === "ws-in" && e.path === "/_quillo/live") && x; }, 3000, "the change");
      const d = describeFrame(h.events.find((e) => e.kind === "ws-in"));
      assert.equal(d.what, "changed");
      assert.deepEqual(d.changed, ["db:tasks"]);
      await until(async () => (await page.evaluate("document.querySelector('.count').textContent")) === "3", 3000, "the count");
    });

    test("state is read as it is now, through the protocol, and can be set", async () => {
      const send = (m, p) => page.send(m, p);
      await click(page, "button.inc");
      const r = await until(async () => { const x = await readState(send); return x.ok && JSON.parse(x.components[0].state.n) === 4 && x; }, 3000, "n = 4");
      assert.deepEqual(r.components.map((c) => [c.index, c.name]), [[0, "Counter"], [1, "Inner"], [2, "Counter"], [3, "Inner"]]);
      const c = r.components[0];
      assert.deepEqual(JSON.parse(c.state.note), { kind: "probe", tags: ["a", "b"], price: { $dec: "12.50" } });
      assert.deepEqual(JSON.parse(c.props.label), "clicks");
      assert.deepEqual(c.live.map((l) => [l.name, l.fname, l.topics]), [["items", "list_tasks", ["db:tasks"]]]);
      assert.equal(JSON.parse(r.components[1].props.value), 4, "the inner one's props, which the page does not write");
      // The page still says what the server rendered.
      assert.equal(JSON.parse((await page.evaluate(call(island, 0))).state).n, 3);
      assert.deepEqual(await setState(send, 0, "n", "100"), { ok: true });
      await until(async () => (await page.evaluate("document.querySelector('button.inc').textContent")) === "clicks: 100", 2000, "the button");
      assert.deepEqual(await setState(send, 0, "note", '{"price":{"$dec":"1.10"}}'), { ok: true });
      assert.equal(JSON.parse((await readState(send)).components[0].state.note).price.$dec, "1.10");
      assert.equal((await setState(send, 0, "nothing", "1")).why, "it has no state nothing");
      assert.equal((await setState(send, 42, "n", "1")).why, "no component there any more");
      assert.equal((await setState(send, 0, "n", "{")).ok, false);
    });

    test("a component the browser made has nothing on the page, and is read through the protocol", async () => {
      await click(page, "button.more");
      const s = await until(async () => { const x = await page.evaluate(call(scan)); return x.islands.length === 5 && x; }, 2000, "the new island");
      const made = s.islands.find((x) => !x.server);
      assert.equal(made.name, "Inner");
      assert.deepEqual(await page.evaluate(call(island, made.i)), { name: "Inner", props: null, state: null, live: null, seq: null });
      const r = await readState((m, p) => page.send(m, p));
      assert.equal(JSON.parse(r.components.find((c) => c.index === made.i).props.value), 99);
      const pane = await page.evaluate(`(${selected.toString()})(document.querySelectorAll("p.inner")[1])`);
      assert.match(pane.status, /^made in the browser/);
      assert.equal(pane.props, undefined);
      await click(page, "button.more");
    });

    test("a channel's messages are heard over a WebSocket, and not over WebTransport", async () => {
      const chat = await chrome.page(app.url + "/chat");
      await until(() => chat.evaluate("!!window.__quillo_booted"), 5000, "the chat");
      await until(() => chat.evaluate("!!window.__quilloChannelVia"), 5000, "the channel's connection");
      await click(chat, "button.say");
      await until(async () => (await chat.evaluate("document.querySelector('.last').textContent")) === "hello", 5000, "the message back");
      const via = await chat.evaluate("window.__quilloChannelVia");
      const lines = (await heard(chat)).events.filter((e) => e.path === "/_quillo/wt").map(describeFrame).map((d) => [d.dir, d.what, d.channel]);
      if (via === "websocket") {
        assert.equal(watch, false);
        assert.deepEqual(lines, [["", "channels", undefined], ["out", "join", "room"], ["in", "joined", "room"], ["out", "message", "room"], ["in", "message", "room"]]);
      } else {
        // WebTransport: nothing of it reaches the page's scripts, nor the protocol.
        assert.equal(via, "webtransport");
        assert.deepEqual(lines, []);
      }
    });

    test("the devtools page adds the panel and the Elements pane", async () => {
      const dtp = await chrome.page();
      await dtp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${devtoolsStub.toString()})()` });
      await dtp.go(`chrome-extension://${chrome.extensionId}/devtools.html`);
      const got = await until(() => dtp.evaluate("window.__made && window.__made.expression && window.__made"), 3000, "the panel and pane");
      assert.deepEqual([got.panel, got.page, got.pane], ["Quillo", "panel.html", "Quillo"]);
      assert.deepEqual(await dtp.evaluate("window.__made.shown"), ["quillo-shown", "quillo-hidden"]);
      const pane = await page.evaluate(got.expression.replace("($0)", "(document.querySelector('p.inner'))"));
      assert.equal(pane.component, "Inner");
      // Closed now: the panel's page runs in the same process, and starting to count
      // there would start this one's count again.
      await chrome.closePage(dtp);
    });

    test("the panel shows the page", async () => {
      const panel = await openPanel(chrome, page, app.url);
      // Components.
      await until(() => panel.evaluate("document.querySelectorAll('#tree li[role=treeitem]').length === 4"), 5000, "the tree");
      assert.equal(await panel.evaluate("document.getElementById('mode').textContent"), watch ? "Development (--watch)" : "Production build");
      assert.deepEqual(await panel.evaluate("[...document.querySelectorAll('#tree .tag')].map((e) => e.textContent)"), ["<Counter>", "<Inner>", "<Counter>", "<Inner>"]);
      await panel.evaluate("document.querySelector('#tree li').click()");
      await until(() => panel.evaluate("document.querySelector('#detail h2')?.textContent === '<Counter>'"), 3000, "the detail");
      assert.match(await panel.evaluate("document.querySelector('#detail .status').textContent"), /what the server rendered it with/);
      assert.match(await panel.evaluate("document.getElementById('detail').textContent"), /State \(from the server\)/);
      // A map opens, and stays open when the panel draws it again.
      await panel.evaluate("[...document.querySelectorAll('#detail tr')].find((r) => r.firstChild.textContent === 'note').querySelector('summary').click()");
      await until(() => panel.evaluate("!!document.querySelector('#detail details[open] .kids')"), 2000, "the map to open");
      assert.match(await panel.evaluate("document.querySelector('#detail details[open] .kids').textContent"), /kind"probe"/);
      // Show in Elements: DevTools' own `inspect`, which the panel's eval has.
      await panel.evaluate("[...document.querySelectorAll('#detail button')].find((b) => b.textContent === 'Show in Elements').click()");
      await panel.evaluate("document.querySelector('#tree li').dispatchEvent(new MouseEvent('mouseenter'))");
      await until(() => page.evaluate("!!document.getElementById('quillo-devtools-highlight')"), 2000, "the box");
      await panel.evaluate("document.querySelector('#tree li').dispatchEvent(new MouseEvent('mouseleave'))");
      await shot(panel, `components-${watch ? "watch" : "production"}`);
      // Current state, through the real chrome.debugger.
      await panel.evaluate("document.getElementById('current').click()");
      await until(() => panel.evaluate("/as they are now/.test(document.querySelector('#detail .status').textContent)"), 5000, "current state");
      assert.match(await panel.evaluate("document.getElementById('detail').textContent"), /n100/);
      // Set a state from the panel.
      await panel.evaluate("[...document.querySelectorAll('#detail tr')].find((r) => r.firstChild.textContent === 'n').querySelector('.edit').click()");
      await panel.evaluate(`(() => { const i = document.querySelector('#detail input[type=text]'); i.value = '7'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })()`);
      await until(async () => (await page.evaluate("document.querySelector('button.inc').textContent")) === "clicks: 7", 3000, "the page to show 7");
      await shot(panel, `current-${watch ? "watch" : "production"}`);
      await panel.evaluate("document.getElementById('current').click()");
      // Calls.
      await click(page, "button.echo");
      await click(page, "button.refuse");
      await panel.evaluate("document.querySelector('[data-tab=calls]').click()");
      await until(() => panel.evaluate("[...document.querySelectorAll('#call-list code')].some((c) => c.textContent === 'slow_echo')"), 5000, "the call");
      const rows = await panel.evaluate("[...document.querySelectorAll('#call-list tbody tr')].map((r) => r.textContent)");
      // What the Network panel had before the panel opened comes first.
      assert.match(rows[0], /^list_tasks\(no answer\)/);
      await panel.evaluate("document.querySelector('#call-list tbody tr').click()");
      assert.match(await panel.evaluate("document.getElementById('call-detail').textContent"), /Arguments\(none\)/);
      assert.ok(rows.some((r) => /slow_echo"n=7""echo n=7"/.test(r)), rows.join("\n"));
      assert.ok(rows.some((r) => /refuse"way"err\("no way"\)/.test(r)), rows.join("\n"));
      await panel.evaluate("[...document.querySelectorAll('#call-list tbody tr')].find((r) => r.textContent.startsWith('slow_echo')).click()");
      assert.match(await panel.evaluate("document.getElementById('call-detail').textContent"), /Answer"echo n=7"/);
      await shot(panel, `calls-${watch ? "watch" : "production"}`);
      // Live, after the page loads again.
      await panel.evaluate("document.querySelector('[data-tab=live]').click()");
      await until(() => panel.evaluate("/Follows db:tasks/.test(document.getElementById('follows').textContent)"), 3000, "what the page follows");
      await page.go(app.url + "/");
      await until(() => page.evaluate("!!window.__quillo_booted"), 5000, "Quillo again");
      // What came after the separator: the new page's socket, then the change.
      const afterReload = "(document.getElementById('live-list').textContent.split('The page loaded again')[1] || '')";
      await until(() => panel.evaluate(`${afterReload}.includes('follows')`), 5000, "the new page's socket");
      await rpc(app.url, "add_task", ["again"]);
      await until(() => panel.evaluate(`${afterReload}.includes('changed')`), 5000, "the change");
      assert.match(await panel.evaluate("document.getElementById('follows').textContent"), /Follows db:tasks/);
      await shot(panel, `live-${watch ? "watch" : "production"}`);
      // The Calls tab marks where the page loaded again.
      await panel.evaluate("document.querySelector('[data-tab=calls]').click()");
      assert.equal(await panel.evaluate("[...document.querySelectorAll('#call-list .sep')].map((r) => r.textContent).join()"), `Page: ${app.url}/`);
      // Errors.
      await panel.evaluate("document.querySelector('[data-tab=errors]').click()");
      await until(() => panel.evaluate("document.getElementById('error-list').textContent.includes('cannot add null and int')"), 3000, "the error");
      assert.notEqual(await panel.evaluate("document.getElementById('error-count').hidden"), true);
      // Server.
      await panel.evaluate("document.querySelector('[data-tab=server]').click()");
      await until(() => panel.evaluate("document.getElementById('server-body').textContent.includes('Ready for requests')"), 5000, "the server");
      const server = await panel.evaluate("document.getElementById('server-body').textContent");
      // Query timings came after 0.6.0, which answers 404.
      if (/Not answered \(404\)/.test(server)) assert.match(quilloVersion(), /^quillo 0\.6\.0 \(991e96c/);
      else if (watch) assert.match(server, /select id, text, done from tasks order by id/);
      else assert.match(server, /off: run with --query-stats/);
      assert.match(server, watch ? /Running with --watch/ : /GET\/plain/);
      assert.match(server, watch ? /Run the program with --describe/ : /server fnslow_echo/);
      await shot(panel, `server-${watch ? "watch" : "production"}`);
      // The server gone: the Server tab says so.
      app.stop();
      await panel.evaluate("document.getElementById('refresh-server').click()");
      await until(() => panel.evaluate("/no answer/.test(document.getElementById('server-body').textContent)"), 5000, "no answer");
      // The debugger let go when its tab closes, and refused for a tab that is gone.
      await panel.evaluate("document.querySelector('[data-tab=components]').click()");
      await panel.evaluate("document.getElementById('current').click()");
      await until(() => panel.evaluate("document.getElementById('current').checked && /Current state is on/.test(document.getElementById('state-note').textContent)"), 5000, "the debugger");
      await chrome.closePage(page);
      await until(() => panel.evaluate("!document.getElementById('current').checked && /let go/.test(document.getElementById('state-note').textContent)"), 5000, "the debugger to be let go");
      await panel.evaluate("document.getElementById('current').click()");
      await until(() => panel.evaluate("/cannot be read/.test(document.getElementById('state-note').textContent)"), 5000, "the refusal");
      assert.equal(await panel.evaluate("document.getElementById('current').checked"), false);
    });
  });
}

async function shot(p, name) {
  mkdirSync(OUT, { recursive: true });
  const { data } = await p.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
}

// The panel as a page of the extension's, with chrome.devtools stood in for by this
// process: `inspectedWindow.eval` runs in `target` (its own world, or the content
// script's), the Network panel's requests are the target's own, read through the
// protocol, and `inspectedWindow.tabId` is the target's tab, so that the panel's
// chrome.debugger is the real one.
async function openPanel(chrome, target, origin) {
  const panel = await chrome.page();
  await panel.send("Runtime.addBinding", { name: "qdtHost" });
  await panel.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${stub.toString()})(${JSON.stringify(origin)})` });
  panel.on("Runtime.bindingCalled", async ({ name, payload }) => {
    if (name !== "qdtHost") return;
    const { id, payload: { expr, ctx } } = JSON.parse(payload);
    let answer;
    try {
      const where = ctx ? { contextId: isolated(target).id } : { includeCommandLineAPI: true };
      const r = await target.send("Runtime.evaluate", { expression: expr, returnByValue: true, ...where });
      answer = r.exceptionDetails ? { error: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text } : { value: r.result.value };
    } catch (e) {
      answer = { error: e.message };
    }
    panel.send("Runtime.evaluate", { expression: `__qdtAnswer(${id}, ${JSON.stringify(answer)})` }).catch(() => {});
  });
  // The Network panel's requests, as HAR entries.
  const reqs = new Map();
  await target.send("Network.enable");
  target.on("Network.requestWillBeSent", ({ requestId, request, wallTime, timestamp }) => {
    reqs.set(requestId, { started: new Date(wallTime * 1000).toISOString(), t0: timestamp, request: { url: request.url, method: request.method, headers: Object.entries(request.headers).map(([name, value]) => ({ name, value })), postData: request.postData ? { mimeType: request.headers["Content-Type"] || request.headers["content-type"] || "", text: request.postData } : undefined } });
  });
  target.on("Network.responseReceived", ({ requestId, response }) => {
    const r = reqs.get(requestId);
    if (r) r.response = { status: response.status, headers: Object.entries(response.headers).map(([name, value]) => ({ name, value })) };
  });
  target.on("Network.loadingFinished", async ({ requestId, timestamp }) => {
    const r = reqs.get(requestId);
    reqs.delete(requestId);
    if (!r || !r.response) return;
    let body = "";
    try { body = (await target.send("Network.getResponseBody", { requestId })).body; } catch (_) {}
    const entry = { startedDateTime: r.started, time: (timestamp - r.t0) * 1000, request: r.request, response: r.response };
    panel.send("Runtime.evaluate", { expression: `__qdtFinished(${JSON.stringify(entry)}, ${JSON.stringify(body)})` }).catch(() => {});
  });
  target.on("Page.frameNavigated", ({ frame }) => {
    if (!frame.parentId) panel.send("Runtime.evaluate", { expression: `__qdtNavigated(${JSON.stringify(frame.url)})` }).catch(() => {});
  });
  await panel.go(`chrome-extension://${chrome.extensionId}/panel.html`);
  return panel;
}

// Runs in devtools.html's page, before devtools.js: records what it makes.
function devtoolsStub() {
  const made = (window.__made = { shown: [] });
  const panel = {
    onShown: { addListener: (f) => { made.onShown = f; } },
    onHidden: { addListener: (f) => { made.onHidden = f; } },
  };
  const win = { dispatchEvent: (e) => made.shown.push(e.type) };
  Object.defineProperty(chrome, "devtools", { configurable: true, value: { panels: {
    create(title, icon, page, cb) {
      Object.assign(made, { panel: title, page });
      cb(panel);
      made.onHidden();
      made.onShown(win);
      made.onHidden();
    },
    elements: {
      onSelectionChanged: { addListener: (f) => { made.changed = f; } },
      createSidebarPane(title, cb) {
        made.pane = title;
        cb({ setExpression: (expression) => { made.expression = expression; } });
        made.changed();
      },
    },
  } } });
}

// Runs in the panel's page, before panel.js.
function stub(origin) {
  const waiting = new Map();
  let n = 0;
  const ask = (payload) => new Promise((res) => { const id = ++n; waiting.set(id, res); globalThis.qdtHost(JSON.stringify({ id, payload })); });
  globalThis.__qdtAnswer = (id, v) => { const f = waiting.get(id); waiting.delete(id); if (f) f(v); };
  const finished = [], navigated = [];
  globalThis.__qdtFinished = (entry, body) => { entry.getContent = (cb) => cb(body, ""); for (const f of finished) f(entry); };
  globalThis.__qdtNavigated = (url) => { for (const f of navigated) f(url); };
  const devtools = {
    inspectedWindow: {
      tabId: -1,
      eval(expr, opts, cb) {
        ask({ expr, ctx: !!(opts && opts.useContentScriptContext) }).then((r) => { if (cb) cb(r.value, r.error ? { isException: true, value: r.error } : undefined); });
      },
    },
    network: {
      onRequestFinished: { addListener: (f) => finished.push(f) },
      onNavigated: { addListener: (f) => navigated.push(f) },
      // One call the Network panel had before the panel opened, its body not kept.
      getHAR: (cb) => cb({ entries: [{ request: { url: origin + "/_quillo/rpc/list_tasks", method: "POST", headers: [] }, response: { status: 0, headers: [], content: {} } }] }),
    },
    panels: { themeName: "default" },
  };
  Object.defineProperty(chrome, "devtools", { value: devtools, configurable: true });
  chrome.tabs.query({}, (tabs) => {
    const t = tabs.find((x) => x.url && x.url.startsWith(origin + "/") && !x.url.endsWith("/plain"));
    if (t) devtools.inspectedWindow.tabId = t.id;
  });
}
