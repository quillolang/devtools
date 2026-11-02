// The Quillo panel. It reads the inspected page through the developer tools' own
// channels: `inspectedWindow.eval` (the islands on the page, and what the content
// scripts heard), the Network panel's requests (server fn calls), and, when
// "Current state" is on, the debugger protocol (components' state as it is now).

import { call, scan, island, highlight, reveal } from "./lib/page.js";
import { parse, show, kind, opens, typed, keyText, Dec, Big, Err, PropRef } from "./lib/values.js";
import { fromHar, rpcName, flags } from "./lib/calls.js";
import { describe } from "./lib/live.js";
import { readState, setState } from "./lib/state.js";
import { debuggerFor } from "./lib/debugger.js";

const dt = chrome.devtools;
const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

if (dt.panels && dt.panels.themeName === "dark") document.documentElement.classList.add("dark");

// What `eval` gives, or `{ error }`.
const evalPage = (expr, opts) => new Promise((res) => {
  dt.inspectedWindow.eval(expr, opts || {}, (r, ex) => res(ex && (ex.isError || ex.isException) ? { error: ex.description || ex.value || ex.code || "error" } : { value: r }));
});

const S = {
  shown: true,
  tab: "components",
  page: null,          // what `scan` gave
  picked: -1,          // the island picked, by index
  pickedName: null,
  data: null,          // `island(picked)`
  current: null,       // `readState`'s answer, while "Current state" is on
  dbg: null,
  calls: [],
  pickedCall: -1,
  idems: new Set(),
  live: [],
  follows: [],
  errors: [],
  doc: null,
  seen: 0,
  bridge: true,
  editing: null,       // [index, state name] being typed in
  off: "",             // why "Current state" is off, when it went off by itself
  offWhy: false,
  open: new Set(),     // values opened, by their path
  drawn: { tree: "", detail: "" },
};

// ---- tabs ------------------------------------------------------------------

for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));

function showTab(name) {
  S.tab = name;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
  for (const t of document.querySelectorAll(".tab")) t.hidden = t.id !== name;
  if (name === "server") loadServer();
  if (name === "errors") drawErrors();
  if (name === "live") drawLive();
  if (name === "calls") drawCalls();
}

addEventListener("quillo-shown", () => { S.shown = true; tick(); });
addEventListener("quillo-hidden", () => { S.shown = false; evalPage(call(highlight, -1)); });

// ---- values ----------------------------------------------------------------

// A value, opening where it has more in it; `path` names it, so that what was
// opened stays open when the panel draws it again.
function value(v, path) {
  const cls = typeof v === "string" ? "str" : typeof v === "number" || v instanceof Dec || v instanceof Big ? "num"
    : v === null || v === undefined || typeof v === "boolean" ? "kw" : v instanceof Err ? "err" : "";
  if (!opens(v)) return h("span", { class: `v ${cls}`, title: kind(v) }, show(v, 400));
  const inner = v instanceof Err ? v.error : v;
  const d = h("details", { class: `v ${cls}` }, h("summary", {}, show(v, 100), h("span", { class: "kind" }, kind(v))));
  if (S.open.has(path)) d.open = true;
  const fill = () => {
    if (d.querySelector(".kids")) return;
    const t = h("table", { class: "kv kids" });
    for (const k of Object.keys(inner)) t.append(h("tr", {}, h("td", {}, Array.isArray(inner) ? k : keyText(k)), h("td", {}, value(inner[k], `${path}.${k}`))));
    d.append(t);
  };
  if (d.open) fill();
  d.addEventListener("toggle", () => {
    if (d.open) { S.open.add(path); fill(); } else S.open.delete(path);
  });
  return d;
}

// Rows of name → value; `edit(name)`, if given, offers to set each.
function rows(map, path, edit) {
  const t = h("table", { class: "kv" });
  const names = Object.keys(map);
  if (!names.length) return h("p", { class: "empty" }, "None.");
  for (const k of names) {
    const editing = edit && S.editing && S.editing[0] === S.picked && S.editing[1] === k;
    const cell = editing ? editor(k, map[k]) : value(map[k], `${path}.${k}`);
    t.append(h("tr", {}, h("td", {}, k), h("td", {}, cell, edit && !editing && h("button", { class: "edit", title: `Set ${k}`, onclick: () => { S.editing = [S.picked, k]; drawDetail(true); } }, "✎"))));
  }
  return t;
}

function editor(name, now) {
  const why = h("div", { class: "why" });
  const input = h("input", { type: "text", value: now instanceof Dec ? now.text + "d" : now instanceof Err || now instanceof PropRef ? "" : JSON.stringify(now, (k, x) => (x instanceof Big ? Number(x.text) : x)), "aria-label": `New value of ${name}` });
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Escape") { S.editing = null; drawDetail(true); return; }
    if (e.key !== "Enter") return;
    const t = typed(input.value);
    if (!t.ok) { why.textContent = t.why; return; }
    const r = await setState(S.dbg.send, S.picked, name, t.text);
    if (!r.ok) { why.textContent = r.why; return; }
    S.editing = null;
    await tick();
    drawDetail(true);
  });
  queueMicrotask(() => { input.focus(); input.select(); });
  return h("div", {}, input, why);
}

const parsed = (text) => {
  const p = parse(text);
  return p.ok ? p.value : null;
};

// ---- components ------------------------------------------------------------

async function tick() {
  if (!S.shown) return;
  const r = await evalPage(call(scan));
  S.page = r.error ? null : r.value;
  if (S.page && S.picked >= 0) {
    const d = await evalPage(call(island, S.picked));
    S.data = d.error ? null : d.value;
    // The page changed under the pick: find the island of that name again.
    if (!S.data || S.data.name !== S.pickedName) { S.picked = -1; S.data = null; }
  }
  if (S.dbg && S.dbg.attached && S.page && S.page.quillo) S.current = await readState(S.dbg.send);
  await drain();
  drawMode();
  drawTree();
  drawDetail();
  if (S.tab === "errors") drawErrors();
}

function drawMode() {
  const m = $("mode");
  const p = S.page;
  m.className = "mode" + (p && p.dev ? " dev" : "");
  m.textContent = !p ? "" : !p.quillo ? "Not a Quillo page" : p.dev ? "Development (--watch)" : "Production build";
  const n = S.errors.filter((e) => !e.sep).length;
  $("error-count").hidden = n === 0;
  $("error-count").textContent = n;
}

const currentOf = (i) => (S.current && S.current.ok ? S.current.components.find((c) => c.index === i) : null);

function drawTree() {
  const p = S.page;
  const find = $("find").value.trim().toLowerCase();
  const list = p && p.quillo ? p.islands.filter((x) => !find || x.name.toLowerCase().includes(find)) : [];
  const key = JSON.stringify([list, S.picked, S.current && S.current.ok && S.current.components.map((c) => [c.index, c.live.length])]);
  if (key === S.drawn.tree) return;
  S.drawn.tree = key;
  const tree = $("tree");
  tree.replaceChildren();
  if (!p) { tree.append(h("li", { class: "empty" }, "The page cannot be read (it may still be loading).")); return; }
  if (!p.quillo) { tree.append(h("li", { class: "empty" }, "No Quillo on this page.")); return; }
  if (!p.islands.length) { tree.append(h("li", { class: "empty" }, "No component on this page: its views are plain HTML.")); return; }
  for (const x of list) {
    const cur = currentOf(x.i);
    const li = h("li", {
      role: "treeitem",
      "aria-selected": String(x.i === S.picked),
      style: `padding-left:${8 + (find ? 0 : x.depth) * 14}px`,
      onclick: () => pick(x.i, x.name),
      onmouseenter: () => evalPage(call(highlight, x.i)),
      onmouseleave: () => evalPage(call(highlight, -1)),
    },
    h("span", { class: "tag" }, `<${x.name}>`),
    !x.resumed && h("span", { class: "flag", title: "The browser has not run it yet: it runs when someone reaches for it" }, "waiting"),
    !x.server && h("span", { class: "flag", title: "Made in the browser, not by the server" }, "browser"),
    x.deferred && h("span", { class: "flag", title: "Its state comes after the page (deferred)" }, "deferred"),
    (x.live || (cur && cur.live.length > 0)) && h("span", { class: "flag", title: "Has live state, which follows the server" }, "live"));
    tree.append(li);
  }
}

function pick(i, name) {
  S.picked = i;
  S.pickedName = name;
  S.editing = null;
  S.data = null;
  evalPage(call(island, i)).then((d) => { S.data = d.error ? null : d.value; drawTree(); drawDetail(true); });
}

function drawDetail(force) {
  const box = $("detail");
  const x = S.page && S.page.quillo && S.page.islands[S.picked];
  const cur = x ? currentOf(x.i) : null;
  const key = JSON.stringify([x, S.data, cur, S.editing, S.current && !S.current.ok && S.current.why]);
  if (!force && (key === S.drawn.detail || S.editing)) return;
  S.drawn.detail = key;
  box.replaceChildren();
  drawStateNote();
  if (!x || !S.data) { box.append(h("p", { class: "empty" }, "Pick a component.")); return; }
  const on = !!(S.dbg && S.dbg.attached);
  const status = !x.resumed ? "Not taken up yet: the browser has not run its code, which it does when someone reaches for it. Its state is the server's."
    : cur ? "Running. Props and state as they are now."
    : !x.server ? "Made in the browser: nothing about it is written on the page." + (on ? "" : " Turn on Current state to see its props and state.")
    : "Running. Below is what the server rendered it with: its state may have changed since." + (on ? "" : " Turn on Current state to see it as it is now.");
  box.append(
    h("h2", {}, h("span", { class: "tag" }, `<${x.name}>`)),
    h("p", { class: "status" }, status),
    h("div", { class: "actions" }, h("button", { onclick: () => evalPage(call(reveal, x.i), {}) }, "Show in Elements")),
  );
  // Props: as they are, or as the server wrote them (an island inside another is
  // written with none: its outer one passes them).
  const pathOf = (what) => `${x.i}:${x.name}:${what}`;
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, parsed(t)]));
  box.append(h("h3", {}, "Props"));
  if (cur) box.append(rows(map(cur.props), pathOf("props")));
  else if (S.data.props === null) box.append(h("p", { class: "empty" }, "Not written on the page."));
  else {
    const props = parsed(S.data.props) || {};
    box.append(rows(props, pathOf("props")));
    if (!Object.keys(props).length && x.parent >= 0) box.append(h("p", { class: "note" }, `Inside <${S.page.islands[x.parent].name}>, which passes them when it runs: turn on Current state to see them.`));
  }
  box.append(h("h3", {}, cur ? "State" : "State (from the server)"));
  if (cur) box.append(rows(map(cur.state), pathOf("state"), true));
  else if (S.data.state === null) box.append(h("p", { class: "empty" }, "Not written on the page."));
  else box.append(rows(parsed(S.data.state) || {}, pathOf("state")));
  // Live states: what they call, and the topics that make them load again.
  const lives = cur ? cur.live.map((l) => ({ name: l.name, f: l.fname, a: parsed(l.args), t: l.topics, loading: l.loading, every: l.every }))
    : Object.entries(parsed(S.data.live) || {}).map(([name, l]) => ({ name, f: l.f, a: l.a, t: l.t || [] }));
  if (lives.length) {
    box.append(h("h3", {}, "Live"));
    const t = h("table", { class: "kv" });
    for (const l of lives) {
      t.append(h("tr", {}, h("td", {}, l.name), h("td", {},
        h("code", {}, `live(${[l.f, ...(Array.isArray(l.a) ? l.a.map((v) => show(v, 40)) : [])].join(", ")})`),
        l.loading ? h("span", { class: "flag" }, "loading") : null,
        l.every ? h("span", { class: "flag" }, `at most every ${l.every} ms`) : null,
        h("div", { class: "note", style: "margin:0" }, l.t.length ? `loads again when ${l.t.join(", ")} change${l.t.length === 1 ? "s" : ""}` : "reads no table or global: it does not load again"))));
    }
    box.append(t);
  }
}

// What "Current state" says: why it is off (S.off), why it cannot read, or that it is on.
function drawStateNote() {
  const note = $("state-note");
  const c = S.current;
  const on = !!(S.dbg && S.dbg.attached);
  note.textContent = !on ? S.off || ""
    : c && !c.ok ? `Current state: ${c.why}`
    : "Current state is on: the browser's bar says it is debugging this tab. Click ✎ beside a state to set it.";
  note.className = (on && c && !c.ok) || (!on && S.offWhy) ? "note why" : "note";
}

$("find").addEventListener("input", () => drawTree());

$("current").addEventListener("change", async (e) => {
  if (e.target.checked) {
    S.dbg = S.dbg || debuggerFor(dt.inspectedWindow.tabId, () => {
      $("current").checked = false;
      S.current = null;
      S.off = "Current state is off: the debugger was let go (its bar was closed, the tab closed, or another debugger took over).";
      S.offWhy = false;
      drawDetail(true);
      drawStateNote();
    });
    try {
      await S.dbg.attach();
      S.off = "";
    } catch (err) {
      e.target.checked = false;
      S.off = `Current state cannot be read: ${err.message}`;
      S.offWhy = true;
      drawStateNote();
      return;
    }
  } else {
    if (S.dbg) await S.dbg.detach();
    S.current = null;
  }
  await tick();
  drawDetail(true);
});

// ---- calls -----------------------------------------------------------------

function addCall(c) {
  if (c.idem) { c.resent = S.idems.has(c.idem); S.idems.add(c.idem); }
  S.calls.push(c);
  if (S.calls.length > 1000) { S.calls.shift(); S.pickedCall--; }
  if (S.tab === "calls") drawCalls();
}

dt.network.onRequestFinished.addListener((req) => {
  if (!rpcName((req.request && req.request.url) || "")) return;
  req.getContent((body) => {
    const c = fromHar(req, body);
    if (c) addCall(c);
  });
});

// What was asked before the panel opened (the Network panel kept it).
if (dt.network.getHAR) {
  dt.network.getHAR((har) => {
    for (const e of (har && har.entries) || []) {
      const c = fromHar(e, e.response && e.response.content ? e.response.content.text : null);
      if (c) addCall(c);
    }
  });
}

dt.network.onNavigated && dt.network.onNavigated.addListener((url) => {
  S.calls.push({ sep: true, url });
  S.picked = -1;
  S.current = null;
  S.drawn.tree = "";
  if (S.tab === "calls") drawCalls();
  tick();
});

const answerText = (c) => c.kind === "ok" ? show(c.value, 80) : c.kind === "err" ? `err(${show(c.value instanceof Err ? c.value.error : c.value, 70)})`
  : c.kind === "patch" ? "(a patch to the last answer)" : c.kind === "none" ? "(no answer)" : c.error;

function drawCalls() {
  const find = $("find-call").value.trim().toLowerCase();
  const body = $("call-list").tBodies[0];
  body.replaceChildren();
  S.calls.forEach((c, n) => {
    if (c.sep) { if (!find) body.append(h("tr", { class: "sep" }, h("td", { colspan: 5 }, `Page: ${c.url}`))); return; }
    if (find && !c.name.toLowerCase().includes(find)) return;
    const bad = c.kind === "failed" || c.kind === "err" || c.kind === "none";
    body.append(h("tr", { "aria-selected": String(n === S.pickedCall), onclick: () => { S.pickedCall = n; drawCalls(); drawCall(); } },
      h("td", {}, h("code", {}, c.name), ...flags(c).map((f) => h("span", { class: "flag" }, f)), c.resent && h("span", { class: "flag warn", title: "The same call again, with the same key: no answer came, or the server was busy" }, "resent")),
      h("td", { class: "mono" }, c.args ? c.args.map((a) => show(a, 40)).join(", ") : c.argsText),
      h("td", { class: `mono ${bad ? "bad" : ""}` }, answerText(c)),
      h("td", { class: "num" }, c.ms === null ? "" : c.ms),
      h("td", { class: `num ${c.status >= 400 || !c.status ? "bad" : ""}` }, c.status || "")));
  });
}

function drawCall() {
  const box = $("call-detail");
  const c = S.calls[S.pickedCall];
  box.replaceChildren();
  if (!c || c.sep) { box.append(h("p", { class: "empty" }, "Pick a call.")); return; }
  const path = `call${S.pickedCall}`;
  box.append(h("h2", {}, h("code", {}, `${c.name}(…)`)),
    h("p", { class: "status" }, [c.started && new Date(c.started).toLocaleTimeString(), c.ms !== null && `${c.ms} ms`, `status ${c.status || "none"}`, c.request && `request ${c.request}`].filter(Boolean).join(" · ")));
  box.append(h("h3", {}, "Arguments"));
  if (c.args) box.append(rows(Object.fromEntries(c.args.map((a, i) => [String(i + 1), a])), `${path}.args`));
  else box.append(h("pre", { class: "v" }, c.argsText || "(none)"));
  if (c.files) box.append(h("p", { class: "note" }, `${c.files} file${c.files === 1 ? "" : "s"} sent beside them.`));
  box.append(h("h3", {}, c.kind === "err" ? "Answer: an error value" : c.kind === "failed" ? "Failed" : c.kind === "patch" ? "Answer: a patch" : "Answer"));
  if (c.kind === "failed" || c.kind === "none") box.append(h("p", { class: "why" }, c.error || "No answer: the call was cut off, or the page went away first."));
  else box.append(value(c.kind === "err" && c.value instanceof Err ? c.value.error : c.value, `${path}.answer`));
  if (c.kind === "patch") box.append(h("p", { class: "note" }, "The live state already had an answer, so the server sent only what changed in it."));
  if (c.topics.length) box.append(h("h3", {}, "Read"), h("p", {}, h("code", {}, c.topics.join(", "))), h("p", { class: "note" }, "A live state that calls this loads again when one of these changes."));
  const f = flags(c);
  if (f.length || c.idem) box.append(h("h3", {}, "How it was sent"), h("p", {}, [...f, c.idem && `idempotency key ${c.idem}`].filter(Boolean).join(" · ")));
}

$("find-call").addEventListener("input", drawCalls);
$("clear-calls").addEventListener("click", () => { S.calls = []; S.pickedCall = -1; drawCalls(); drawCall(); });

// ---- what the content scripts heard: live updates and errors ------------------

async function drain() {
  let r = await evalPage(`__quilloDevtools.since(${S.seen})`, { useContentScriptContext: true });
  if (r.error || !r.value) { S.bridge = false; return; }
  S.bridge = true;
  if (r.value.doc !== S.doc) {
    if (S.doc !== null) {
      S.live.push({ sep: true, at: Date.now() });
      S.errors.push({ sep: true, at: Date.now() });
    }
    S.doc = r.value.doc;
    S.follows = [];
    if (S.seen) r = await evalPage("__quilloDevtools.since(0)", { useContentScriptContext: true });
    if (r.error || !r.value) return;
  }
  S.seen = r.value.last;
  let more = false;
  for (const e of r.value.events) {
    if (e.kind === "error") { S.errors.push({ at: e.at, message: e.message }); more = true; }
    if (e.kind.startsWith("ws-")) {
      const d = describe(e);
      if (d.what === "follows") S.follows = d.topics;
      S.live.push(d);
      more = true;
    }
  }
  if (S.live.length > 2000) S.live.splice(0, S.live.length - 2000);
  if (more && S.tab === "live") drawLive();
}

const clock = (t) => new Date(t).toLocaleTimeString([], { hour12: false }) + "." + String(t % 1000).padStart(3, "0");

function drawLive() {
  $("follows").textContent = !S.bridge ? "Reload the page: the extension hears live updates from when a page starts."
    : S.follows.length ? `Follows ${S.follows.join(", ")}` : "No live state on this page follows anything.";
  const body = $("live-list").tBodies[0];
  body.replaceChildren();
  for (const l of S.live.slice(-500)) {
    if (l.sep) { body.append(h("tr", { class: "sep" }, h("td", { colspan: 5 }, "The page loaded again"))); continue; }
    body.append(h("tr", {}, h("td", { class: "mono" }, clock(l.at)), h("td", {}, l.path), h("td", {}, l.dir === "in" ? "↓" : l.dir === "out" ? "↑" : ""),
      h("td", {}, l.what), h("td", { class: "mono" }, l.what === "message" ? `${l.channel}: ${show(l.value, 100)}` : l.detail)));
  }
}
$("clear-live").addEventListener("click", () => { S.live = []; drawLive(); });

function drawErrors() {
  const p = S.page;
  $("counts").textContent = !S.bridge ? "Reload the page: the extension hears errors from when a page starts."
    : p && p.quillo ? `${p.counts.resumed} component${p.counts.resumed === 1 ? "" : "s"} taken up as the server sent them, ${p.counts.remade} made again (their HTML was not what they make: under --watch the console says why).` : "";
  const list = $("error-list");
  list.replaceChildren();
  if (!S.errors.length) list.append(h("li", { class: "sep" }, "No error so far."));
  for (const e of S.errors) {
    if (e.sep) { list.append(h("li", { class: "sep" }, "The page loaded again")); continue; }
    list.append(h("li", {}, h("time", {}, clock(e.at)), e.message));
  }
  drawMode();
}
$("clear-errors").addEventListener("click", () => { S.errors = []; drawErrors(); });

// ---- the server ------------------------------------------------------------

async function get(path, json) {
  try {
    const r = await fetch(S.page.origin + path, { cache: "no-store", credentials: "omit" });
    const text = await r.text();
    let body = text;
    if (json) { try { body = JSON.parse(text); } catch (_) {} }
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: String(e.message || e) };
  }
}

async function loadServer() {
  const box = $("server-body");
  if (!S.page || !S.page.quillo) { box.replaceChildren(h("p", { class: "empty" }, "No Quillo on this page.")); return; }
  $("origin").textContent = S.page.origin;
  const [health, ready, queries, dev, api] = await Promise.all([
    get("/_quillo/health"), get("/_quillo/ready", true), get("/_quillo/health/queries", true), get("/_quillo/dev"), get("/_quillo/describe", true)]);
  box.replaceChildren();
  box.append(h("h3", {}, "Health"),
    h("p", {}, health.status === 200 ? h("span", { class: "ok" }, "Ready for requests") : h("span", { class: "why" }, `${health.status || "no answer"}: ${health.body}`)));
  if (ready.body && typeof ready.body === "object" && ready.body.checks) {
    const t = h("table", { class: "kv" });
    for (const [k, v] of Object.entries(ready.body.checks)) t.append(h("tr", {}, h("td", {}, k), h("td", { class: v === "ready" ? "ok" : "why" }, v)));
    box.append(h("h3", {}, "What it needs"), t);
  }
  box.append(h("h3", {}, "Database queries"));
  const q = queries.body;
  if (!q || typeof q !== "object") box.append(h("p", { class: "empty" }, `Not answered (${queries.status}).`));
  else if (!q.enabled) box.append(h("p", { class: "note", style: "margin:0" }, q.how || "Off."));
  else {
    const all = q.queries || {};
    box.append(h("p", {}, `${all.total || 0} in all, ${all.errors || 0} failed; of the last ${all.count || 0}: ${all.min_ms} to ${all.max_ms} ms, ${all.avg_ms} ms on average.`));
    const t = h("table", { class: "list" }, h("thead", {}, h("tr", {}, h("th", {}, "Statement"), h("th", { class: "num" }, "Runs"), h("th", { class: "num" }, "Avg ms"), h("th", { class: "num" }, "Max ms"), h("th", { class: "num" }, "Failed"))));
    const tb = h("tbody");
    for (const s of [...(q.statements || [])].sort((a, b) => b.avg_ms * b.count - a.avg_ms * a.count)) {
      tb.append(h("tr", {}, h("td", { class: "mono", title: s.sql }, s.sql), h("td", { class: "num" }, s.total), h("td", { class: "num" }, s.avg_ms), h("td", { class: "num" }, s.max_ms), h("td", { class: `num ${s.errors ? "bad" : ""}` }, s.errors)));
    }
    t.append(tb);
    box.append(t);
  }
  if (dev.status === 200) box.append(h("h3", {}, "Development"), h("p", {}, `Running with --watch, version ${dev.body.trim()}: a saved change reloads this page.`));
  box.append(h("h3", {}, "API"));
  if (api.status === 200 && api.body && api.body.paths) {
    const t = h("table", { class: "kv" });
    for (const [p, ops] of Object.entries(api.body.paths)) t.append(h("tr", {}, h("td", {}, Object.keys(ops).map((m) => m.toUpperCase()).join(" ")), h("td", { class: "mono" }, p)));
    // Server fns are listed apart: `x-quillo-server-fns`, a map of name to what it takes
    // and gives; each is a POST to /_quillo/rpc/<name>.
    const fns = api.body["x-quillo-server-fns"];
    for (const f of Array.isArray(fns) ? fns : Object.keys(fns || {})) t.append(h("tr", {}, h("td", {}, "server fn"), h("td", { class: "mono" }, f)));
    box.append(t);
  } else box.append(h("p", { class: "note", style: "margin:0" }, "Run the program with --describe for its routes and server fns here (GET /_quillo/describe)."));
}
$("refresh-server").addEventListener("click", loadServer);

// ---- start -----------------------------------------------------------------

tick();
setInterval(tick, 1000);
