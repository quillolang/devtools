// Functions the panel runs in the inspected page, as their own text
// (`inspectedWindow.eval(call(scan))`): each stands alone, using nothing from here,
// and gives a value JSON can carry.

// The page's text for running `f` with `args`.
export const call = (f, ...args) => `(${f.toString()})(${args.map((a) => JSON.stringify(a)).join(", ")})`;

// What the page shows of Quillo, from the outside: its islands, as the server wrote
// them, in document order, each with the island it is in.
//
// An island's `data-s` is the state the server rendered it with. Quillo does not
// write it again, so once the island is taken up ("resumed") and its state changes,
// `data-s` is out of date: `stale` says it may be. One the browser made itself has
// no `data-p` or `data-s` at all. An island inside another has `data-p="{}"`: its
// outer one passes its props when it runs.
export function scan() {
  const SEL = "quillo-island,[data-qi]";
  const all = [...document.querySelectorAll(SEL)];
  const scripts = [...document.scripts].map((s) => s.src || "");
  const globals = Object.keys(window).filter((k) => /^(__quillo|quillo)/.test(k)).sort();
  // Quillo's: an island, a script of its, or a global it sets (`__quillo_pf`, from the
  // prefetching script every page of its has).
  // Since Quillo 0.7 what it shares with the page is under one key, not a name each.
  const shared = window[Symbol.for("quillo")] || null;
  const quillo = all.length > 0 || scripts.some((s) => s.includes("/_quillo/")) || globals.length > 0 || !!shared;
  const old = { __quillo_booted: "booted", __quilloResumed: "resumed", __quilloRemade: "remade" };
  const g = (k) => (shared && old[k] && old[k] in shared ? shared[old[k]] : Object.prototype.hasOwnProperty.call(window, k) ? window[k] : undefined);
  return {
    quillo,
    url: location.href,
    origin: location.origin,
    booted: !!g("__quillo_booted"),
    // Under --watch, each file of the program is a script of its own, at
    // /_quillo/src/<hash>/..., and the page listens on /_quillo/events.
    dev: scripts.some((s) => s.includes("/_quillo/src/")) || [...document.scripts].some((s) => !s.src && s.text.includes("/_quillo/events")),
    counts: { resumed: g("__quilloResumed") || 0, remade: g("__quilloRemade") || 0, errors: Array.isArray(g("__quilloErrors")) ? g("__quilloErrors").length : null },
    globals,
    islands: all.map((el, i) => {
      const up = el.parentElement && el.parentElement.closest(SEL);
      let depth = 0;
      for (let p = up; p; p = p.parentElement && p.parentElement.closest(SEL)) depth++;
      const resumed = el.__q === true;
      const server = el.hasAttribute("data-s");
      return {
        i,
        name: el.dataset.c || "?",
        parent: up ? all.indexOf(up) : -1,
        depth,
        tag: el.localName,
        resumed,
        server,
        stale: resumed && server,
        deferred: el.hasAttribute("data-qd"),
        byItself: el.hasAttribute("data-e"),
        live: el.hasAttribute("data-l"),
        // How much the server wrote for it, in characters.
        size: (el.getAttribute("data-p") || "").length + (el.getAttribute("data-s") || "").length,
      };
    }),
  };
}

// What the server wrote for island `i` (each JSON text, or null), with its name, so
// that the panel can tell the islands moved.
export function island(i) {
  const el = document.querySelectorAll("quillo-island,[data-qi]")[i];
  if (!el) return null;
  const attr = (k) => (el.hasAttribute(k) ? el.getAttribute(k) : null);
  return { name: el.dataset.c || "?", props: attr("data-p"), state: attr("data-s"), live: attr("data-l"), seq: attr("data-v") };
}

// A box over island `i` (or none, for -1), with its name: what the panel's row is.
// An island is `display: contents` and has no box of its own, so the box is its
// contents'.
export function highlight(i) {
  const ID = "quillo-devtools-highlight";
  const old = document.getElementById(ID);
  if (old) old.remove();
  const el = i < 0 ? null : document.querySelectorAll("quillo-island,[data-qi]")[i];
  if (!el) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = el.localName === "quillo-island" ? range.getBoundingClientRect() : el.getBoundingClientRect();
  const box = document.createElement("div");
  box.id = ID;
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
    "background:rgba(91,75,219,.18);outline:1px solid rgba(91,75,219,.9);font:11px/1.6 system-ui,sans-serif;color:#fff";
  const label = document.createElement("span");
  label.textContent = `<${el.dataset.c}>  ${Math.round(r.width)} × ${Math.round(r.height)}`;
  label.style.cssText = `position:absolute;left:0;${r.top > 20 ? "top:-19px" : "bottom:-19px"};background:#5b4bdb;padding:0 6px;border-radius:3px;white-space:nowrap`;
  box.append(label);
  document.documentElement.append(box);
  return true;
}

// Selects island `i` in the Elements panel (`inspect` is DevTools' own, there only
// when the panel evaluates; elsewhere this says false).
export function reveal(i) {
  const el = document.querySelectorAll("quillo-island,[data-qi]")[i];
  if (!el || typeof inspect !== "function") return false;
  inspect(el); // eslint-disable-line no-undef
  return true;
}

// For the Elements panel's "Quillo" pane: the island the selected element is in,
// as `scan` reads one, and the islands around it.
export function selected(node) {
  const SEL = "quillo-island,[data-qi]";
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const isl = el && el.closest(SEL);
  if (!isl) return { component: null, note: "Not inside a Quillo component." };
  const json = (k) => {
    if (!isl.hasAttribute(k)) return undefined;
    try { return JSON.parse(isl.getAttribute(k)); } catch (_) { return isl.getAttribute(k); }
  };
  const outer = [];
  for (let p = isl.parentElement && isl.parentElement.closest(SEL); p; p = p.parentElement && p.parentElement.closest(SEL)) outer.push(p.dataset.c);
  const resumed = isl.__q === true;
  return {
    component: isl.dataset.c,
    inside: outer.length ? outer.join(" < ") : "(the page)",
    status: !resumed ? "not taken up yet: the server's HTML, and the state below is what it holds"
      : isl.hasAttribute("data-s") ? "running: the state below is what the server rendered it with, and may have changed since (the panel's Components tab, with current state on, shows it as it is)"
      : "made in the browser: no state written on the page",
    props: json("data-p"),
    "state (from the server)": json("data-s"),
    live: json("data-l"),
  };
}
