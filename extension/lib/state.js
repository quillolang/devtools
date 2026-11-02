// Components' state as it is now, read through the debugger protocol.
//
// Quillo's runtime keeps its components in a closure and gives the page no way to
// reach them: an island's `data-s` is the state the server rendered, never written
// again. So this goes in the way a debugger does. The runtime sets functions made
// inside it on the page (`window.__quillo_resume` since 0.6.0's successors,
// `window.quillo.rpc` when the program has server fns, those of `window.__quillo_rt`
// when pages share one runtime file); the protocol shows a function's closure
// (`[[Scopes]]`), and in that closure are the runtime's own names: `Inst` (a
// component), `Live` (the live states), `toJSON` and `untagDeep` (values to and from
// the wire). `Runtime.queryObjects` on `Inst.prototype` gives every component there
// is. These names are not a promised interface: a runtime that
// renames them leaves this saying so (`missing`), not reading wrong.
//
// `send(method, params)` sends one protocol command and resolves to its result: in
// the extension, chrome.debugger.sendCommand; in the tests, a CDP session.

export const GROUP = "quillo-devtools";
const WANT = ["Inst", "Live", "toJSON", "untagDeep"];

// Functions the runtime puts on the page, any one of which leads into its closure.
const ENTRIES = [
  "window.__quillo_resume",
  "window.quillo && window.quillo.rpc",
  "window.__quillo_rt && Object.values(window.__quillo_rt).find((f) => typeof f === 'function')",
];

export async function runtime(send) {
  const found = {};
  let entry = null;
  for (const expression of ENTRIES) {
    const fn = await send("Runtime.evaluate", { expression, objectGroup: GROUP });
    if (fn.result && fn.result.type === "function") { entry = fn.result.objectId; break; }
  }
  if (entry) {
    const props = await send("Runtime.getProperties", { objectId: entry, ownProperties: false });
    const scopes = (props.internalProperties || []).find((p) => p.name === "[[Scopes]]");
    if (!scopes) return { ok: false, why: "this browser does not show a function's closure" };
    const list = await send("Runtime.getProperties", { objectId: scopes.value.objectId, ownProperties: true });
    for (const s of (list.result || []).filter((x) => /^\d+$/.test(x.name) && x.value && x.value.objectId)) {
      if (/^Global/.test(s.value.description || "")) continue;
      const vars = await send("Runtime.getProperties", { objectId: s.value.objectId, ownProperties: true });
      for (const v of vars.result || []) if (WANT.includes(v.name) && !found[v.name] && v.value && v.value.objectId) found[v.name] = v.value.objectId;
    }
  }
  // Under --watch the runtime is a plain script of its own, so its functions are the
  // page's globals, not in a closure (its classes and `const`s still are).
  for (const n of WANT) {
    if (found[n]) continue;
    const g = await send("Runtime.evaluate", { expression: `typeof ${n} === "function" ? ${n} : undefined`, objectGroup: GROUP });
    if (g.result && g.result.type === "function") found[n] = g.result.objectId;
  }
  // Only `Inst` is needed; a page's runtime carries only what it uses, so the others
  // may be missing, and plain JSON stands in for them.
  const missing = ["Inst"].filter((n) => !found[n]);
  if (missing.length && !entry) return { ok: false, why: "Quillo has not started on this page yet (no component has been reached)" };
  if (missing.length) return { ok: false, why: `this Quillo's runtime has no ${missing.map((n) => "`" + n + "`").join(", ")}: the extension needs updating for it`, missing };
  const proto = await send("Runtime.callFunctionOn", { objectId: found.Inst, functionDeclaration: "function () { return this.prototype; }", objectGroup: GROUP });
  const all = await send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId, objectGroup: GROUP });
  return { ok: true, found, all: all.objects.objectId };
}

export const arg = (id) => (id ? { objectId: id } : { value: null });

export const release = (send) => send("Runtime.releaseObjectGroup", { objectGroup: GROUP }).catch(() => {});

// Every component on the page now: [{ index, name, props, state, live }], `index`
// being its island's place among the page's islands in document order (as `scan`
// gives them), props and state as wire JSON text by name.
export async function readState(send) {
  try {
    const rt = await runtime(send);
    if (!rt.ok) return rt;
    const args = [arg(rt.found.toJSON), arg(rt.found.Live)];
    const r = await send("Runtime.callFunctionOn", {
      objectId: rt.all,
      arguments: args,
      returnByValue: true,
      objectGroup: GROUP,
      functionDeclaration: `function (toJSON, Live) {
        const all = [...document.querySelectorAll("quillo-island,[data-qi]")];
        const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => typeof x === "function" ? "(a function)" : typeof x === "bigint" ? { $int: String(x) } : x));
        const wire = (v) => { try { return JSON.stringify(toJSON ? toJSON(v, true) : plain(v)); } catch (e) { return JSON.stringify("(" + (e && e.message || e) + ")"); } };
        const subs = Live && Live.subs ? [...Live.subs] : [];
        return this.filter((i) => !i.dead && i.el && i.el.isConnected).map((i) => {
          const props = {};
          for (const k of Object.keys(i.props || {})) if (k !== "children") props[k] = wire(i.props[k]);
          const state = {};
          for (const [k, s] of Object.entries(i.sigs || {})) state[k] = wire(s && s.v);
          return {
            index: all.indexOf(i.el),
            name: i.def && i.def.$name || "?",
            props,
            state,
            live: subs.filter((s) => s.inst === i).map((s) => ({ name: s.name, fname: s.fname, args: wire(s.args), topics: s.topics || [], loading: !!s.loading, every: s.every || 0 })),
          };
        });
      }`,
    });
    if (r.exceptionDetails) return { ok: false, why: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
    return { ok: true, components: r.result.value.sort((a, b) => a.index - b.index) };
  } catch (e) {
    return { ok: false, why: String(e && e.message || e) };
  } finally {
    await release(send);
  }
}

// Sets state `name` of the component in island `index` to the value wire JSON
// `text` holds; the page updates as if the component had set it.
export async function setState(send, index, name, text) {
  try {
    const rt = await runtime(send);
    if (!rt.ok) return rt;
    const r = await send("Runtime.callFunctionOn", {
      objectId: rt.all,
      arguments: [arg(rt.found.untagDeep), { value: index }, { value: name }, { value: text }],
      returnByValue: true,
      objectGroup: GROUP,
      functionDeclaration: `function (untagDeep, index, name, text) {
        const el = document.querySelectorAll("quillo-island,[data-qi]")[index];
        const i = this.find((x) => !x.dead && x.el === el);
        if (!i) return "no component there any more";
        const s = i.sigs && i.sigs[name];
        if (!s || typeof s.set !== "function") return "it has no state " + name;
        s.set(untagDeep ? untagDeep(JSON.parse(text)) : JSON.parse(text));
        return "";
      }`,
    });
    if (r.exceptionDetails) return { ok: false, why: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
    return r.result.value ? { ok: false, why: r.result.value } : { ok: true };
  } catch (e) {
    return { ok: false, why: String(e && e.message || e) };
  } finally {
    await release(send);
  }
}
