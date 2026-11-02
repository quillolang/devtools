// Where a component's props come from, and what its states and lets are, read from
// the code Quillo compiled and the runtime's objects, through the debugger protocol.
//
// Quillo compiles a component to a function of its own (`W.component("Name", [...],
// function ($i, $p) { ... })`), the same in production and under --watch:
//
//   const $a_2 = $i.sig("a", () => { return 1; });          state a
//   const $items_4 = W.live($i, "items", "list_tasks", ...)  a live state
//   const $double_4 = W.memo(() => (W.mul($a_2.v, 2)));     let double = a * 2 (worked out again)
//   let $bump_6, $greeting_5;  $greeting_5 = "hi";           a let, set once
//   $bump_6 = function () { ... };                           a let holding a function
//   W.c(G["Child"], {get "value"() { return $a_2.v; }, "fixed": 7}, null)
//                                                            <Child value={a} fixed={7}/>
//
// So each of a child's props is a getter whose text names what it reads in the parent
// (`$a_2` is its `a`; `$p.title` is the parent's own prop `title`), or a fixed value.
// What it reads is followed up through the parents' props to the state or let it ends
// at. A let's value is the browser's where it kept it (in a closure the protocol can
// read); one the browser did not keep is shown as written.
//
// This reads compiled code, which Quillo does not promise to keep in this shape: what
// does not match is said as such (`inside`: made inside the parent's markup, by a view
// or a block, under a name the compiled code does not keep), not guessed.

import { runtime, release, arg, GROUP } from "./state.js";

// A compiled name's own: `$double_4` → `double`.
export const nameOf = (c) => {
  const m = /^\$(.+)_\d+$/.exec(c);
  return m ? m[1] : c;
};

// The text from `open` (just after a "(") to its matching ")", minding strings.
export function balanced(text, open) {
  let depth = 1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
    } else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (--depth === 0) return text.slice(open, i);
    }
  }
  return null;
}

// Where the statement starting at `from` ends: its ";" (or the "}" closing its block),
// minding strings and brackets.
export function statementEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === "\\") i++;
    } else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) return i;
      depth--;
    } else if (ch === ";" && depth === 0) return i;
  }
  return text.length;
}

// How deep in brackets each character of `text` is, minding strings: the component's
// own statements are at depth 1, inside its function's braces.
export function depths(text) {
  const out = new Uint16Array(text.length + 1);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out[i] = depth;
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < text.length && text[i] !== ch; i++) { out[i] = depth; if (text[i] === "\\") out[++i] = depth; }
      out[i] = depth;
    } else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") { depth--; out[i] = depth; }
  }
  out[text.length] = depth;
  return out;
}

// A component's declarations, from its compiled function's text: by compiled name,
// { name, kind: "state" | "live" | "derived" | "function" | "let", text }.
export function declarations(src) {
  const out = {};
  // Only the component's own statements: not those of a function inside it (a
  // handler's `let`), which the browser makes each time it runs.
  const d = depths(src);
  const top = (at) => d[at] === 1;
  const str = '"((?:[^"\\\\]|\\\\.)*)"';
  for (const m of src.matchAll(new RegExp(`const (\\$[\\w$]+_\\d+) = \\$i\\.sig\\(${str}`, "g"))) if (top(m.index)) out[m[1]] = { name: JSON.parse(`"${m[2]}"`), kind: "state" };
  for (const m of src.matchAll(new RegExp(`const (\\$[\\w$]+_\\d+) = W\\.live\\(\\$i, ${str}, ${str}`, "g"))) if (top(m.index)) out[m[1]] = { name: JSON.parse(`"${m[2]}"`), kind: "live", fn: m[3] };
  for (const m of src.matchAll(/const (\$[\w$]+_\d+) = W\.memo\(/g)) {
    if (top(m.index)) out[m[1]] = { name: nameOf(m[1]), kind: "derived", text: balanced(src, m.index + m[0].length) };
  }
  for (const m of src.matchAll(/(?:^|[;{\n])\s*let ((?:\$[\w$]+_\d+)(?:, \$[\w$]+_\d+)*);/g)) {
    if (!top(m.index + m[0].indexOf("let"))) continue;
    for (const c of m[1].split(", ")) {
      const set = [...src.matchAll(new RegExp(`(?:^|[;{}\\n])\\s*\\${c} = `, "g"))].find((x) => top(x.index + x[0].indexOf("$")));
      if (!set) { out[c] = { name: nameOf(c), kind: "let", text: null }; continue; }
      const from = set.index + set[0].length;
      const rest = src.slice(from);
      if (/^(async )?function\b|^(async )?\([^)]*\) =>|^(async )?[\w$]+ =>/.test(rest)) { out[c] = { name: nameOf(c), kind: "function", text: null }; continue; }
      out[c] = { name: nameOf(c), kind: "let", text: src.slice(from, statementEnd(src, from)).trim() };
    }
  }
  return out;
}

// What a piece of compiled code reads of its component: its locals by compiled name,
// and its props (`$p.title`, `$p["two words"]`).
export function reads(text) {
  const locals = [...new Set([...String(text).matchAll(/\$[\w$]+_\d+(?![\w$])/g)].map((m) => m[0]))];
  const props = [...new Set([...String(text).matchAll(/\$p(?:\.([\w$]+)|\["((?:[^"\\]|\\.)*)"\])/g)].map((m) => m[1] || JSON.parse(`"${m[2]}"`)))];
  return { locals, props };
}

// Runs in the page, on the runtime's components (`this`): the component in island
// `index`, its props with where each comes from, and its states and lets. The helpers
// above come in as text.
const PAGE = `function (toJSON, index) {
  ${nameOf.toString().replace(/^/, "const nameOf = ")};
  ${balanced.toString()}
  ${statementEnd.toString()}
  ${depths.toString()}
  ${declarations.toString()}
  ${reads.toString()}
  const ISL = "quillo-island,[data-qi]";
  const islands = [...document.querySelectorAll(ISL)];
  const live = this.filter((i) => !i.dead && i.el && i.el.isConnected);
  const at = (el) => live.find((i) => i.el === el) || null;
  const wire = (v) => { try { return JSON.stringify(toJSON ? toJSON(v, true) : v); } catch (e) { return JSON.stringify("(" + (e && e.message || e) + ")"); } };
  const decl = new Map();
  const declOf = (i) => { if (!decl.has(i)) decl.set(i, declarations(String(i.def))); return decl.get(i); };
  const outer = (i) => { const p = i.el.parentElement && i.el.parentElement.closest(ISL); return p ? at(p) : null; };
  const who = (i) => ({ owner: islands.indexOf(i.el), ownerName: i.def.$name });
  // A memo's runtime object, found by its function's text among what it owns.
  const memoOf = (i, d) => (i.owned || []).find((c) => c && c.effect === false && typeof c.fn === "function" && String(c.fn) === d.text) || null;
  const valueOf = (i, c, d) => {
    if (d.kind === "state" || d.kind === "live") return i.sigs && i.sigs[d.name] ? wire(i.sigs[d.name].v) : null;
    if (d.kind === "derived") { const m = memoOf(i, d); return m ? wire(m._v) : null; }
    return null;
  };
  // What a piece of i's code reads, each followed to where it ends.
  const refsIn = (i, text, depth) => {
    const r = reads(text), d = declOf(i), out = [];
    for (const c of r.locals) {
      const x = d[c];
      // A loop's item ("for k in xs", compiled "$row_10") has no name of its own left.
      out.push(x ? { ...who(i), kind: x.kind, name: x.name, compiled: c, value: valueOf(i, c, x) }
        : /^\\$row_\\d+$/.test(c) ? { ...who(i), kind: "row" } : { ...who(i), kind: "inside", name: nameOf(c) });
    }
    // A prop the component does not take is a view's, between it and the child.
    for (const p of r.props) {
      out.push((i.def.$p || []).includes(p) ? { ...who(i), kind: "prop", name: p, from: depth < 8 ? propFrom(i, p, depth + 1) : [] } : { ...who(i), kind: "inside", name: p });
    }
    return out;
  };
  // Where i's prop p comes from: what its getter reads in the component around it.
  const propFrom = (i, p, depth) => {
    const desc = Object.getOwnPropertyDescriptor(i.props || {}, p);
    if (!desc) return [{ kind: "default", name: p }];
    if (!desc.get) {
      const up = outer(i);
      return [up ? { kind: "fixed", value: wire(desc.value) } : { kind: "server", value: wire(desc.value) }];
    }
    const up = outer(i);
    if (!up) return [{ kind: "unknown", name: p }];
    return refsIn(up, String(desc.get), depth);
  };
  const i = at(islands[index]);
  if (!i) return null;
  const d = declOf(i);
  // Its parameters, given or not (one not given takes its default).
  const names = [...new Set([...(i.def.$p || []), ...Object.keys(i.props || {})])].filter((k) => k !== "children");
  const props = names.map((k) => {
    const given = Object.prototype.hasOwnProperty.call(i.props || {}, k);
    let value = null;
    if (given) { try { value = wire(i.props[k]); } catch (e) { value = JSON.stringify("(" + (e && e.message || e) + ")"); } }
    return { name: k, value, from: propFrom(i, k, 0) };
  });
  const vars = Object.keys(d).map((c) => {
    const x = d[c];
    const v = { compiled: c, name: x.name, kind: x.kind, value: valueOf(i, c, x), reads: [] };
    if (x.kind === "derived") v.reads = refsIn(i, x.text, 0);
    if (x.kind === "live") v.fn = x.fn;
    if (x.kind === "let") v.text = x.text;
    return v;
  });
  return { index, name: i.def.$name, props, vars };
}`;

// The functions made in the component's code that the browser keeps: what leads to
// the values of its plain lets, through their closure.
const CLOSURES = `function (index) {
  const ISL = "quillo-island,[data-qi]";
  const el = document.querySelectorAll(ISL)[index];
  const i = this.find((x) => !x.dead && x.el === el);
  if (!i) return [];
  const out = [];
  for (const c of i.owned || []) if (c && typeof c.fn === "function") out.push(c.fn);
  for (const k of this.filter((x) => !x.dead && x.el && x.el.isConnected && x.el.parentElement && x.el.parentElement.closest(ISL) === el)) {
    for (const p of Object.keys(k.props || {})) { const g = Object.getOwnPropertyDescriptor(k.props, p).get; if (g) out.push(g); }
  }
  return out.slice(0, 24);
}`;

// The values the closures hold for `names` (compiled names), as wire JSON text.
async function kept(send, rt, index, names) {
  const found = {};
  const list = await send("Runtime.callFunctionOn", { objectId: rt.all, arguments: [{ value: index }], functionDeclaration: CLOSURES, objectGroup: GROUP });
  const items = await send("Runtime.getProperties", { objectId: list.result.objectId, ownProperties: true });
  const fns = (items.result || []).filter((x) => /^\d+$/.test(x.name) && x.value && x.value.objectId).map((x) => x.value.objectId);
  const seen = new Set();
  // Each function's closure, and the functions held in it, two steps deep.
  for (let step = 0, todo = fns; step < 2 && todo.length && names.some((n) => !found[n]); step++) {
    const next = [];
    for (const fn of todo) {
      if (seen.has(fn)) continue;
      seen.add(fn);
      const props = await send("Runtime.getProperties", { objectId: fn, ownProperties: false });
      const scopes = (props.internalProperties || []).find((p) => p.name === "[[Scopes]]");
      if (!scopes) continue;
      const list2 = await send("Runtime.getProperties", { objectId: scopes.value.objectId, ownProperties: true });
      for (const s of (list2.result || []).filter((x) => /^\d+$/.test(x.name) && x.value && x.value.objectId && !/^Global/.test(x.value.description || ""))) {
        const vars = await send("Runtime.getProperties", { objectId: s.value.objectId, ownProperties: true });
        for (const v of vars.result || []) {
          if (names.includes(v.name) && !(v.name in found)) found[v.name] = v.value;
          else if (v.value && v.value.type === "function" && v.value.objectId && next.length < 24) next.push(v.value.objectId);
        }
      }
    }
    todo = next;
  }
  const out = {};
  for (const [n, v] of Object.entries(found)) {
    if (!v || v.type === "undefined") out[n] = "null";
    else if (!v.objectId) out[n] = JSON.stringify(v.value === undefined ? null : v.value);
    else if (v.type === "function") out[n] = null;
    else {
      const r = await send("Runtime.callFunctionOn", { objectId: v.objectId, arguments: [arg(rt.found.toJSON)], returnByValue: true, objectGroup: GROUP,
        functionDeclaration: "function (toJSON) { try { return JSON.stringify(toJSON ? toJSON(this, true) : this); } catch (e) { return null; } }" });
      out[n] = r.result ? r.result.value : null;
    }
  }
  return out;
}

// The picked component in island `index`: { ok, name, props, vars }, or { ok: false, why }.
export async function readMapping(send, index) {
  try {
    const rt = await runtime(send);
    if (!rt.ok) return rt;
    const r = await send("Runtime.callFunctionOn", { objectId: rt.all, arguments: [arg(rt.found.toJSON), { value: index }], returnByValue: true, objectGroup: GROUP, functionDeclaration: PAGE });
    if (r.exceptionDetails) return { ok: false, why: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
    const m = r.result.value;
    if (!m) return { ok: false, why: "no component there any more" };
    const want = m.vars.filter((v) => v.kind === "let").map((v) => v.compiled);
    if (want.length) {
      const values = await kept(send, rt, index, want);
      for (const v of m.vars) if (v.compiled in values) { v.value = values[v.compiled]; v.kept = true; }
      // A let that a derived let reads, its value the same.
      for (const v of m.vars) for (const r of v.reads) if (r.owner === index && r.compiled in values) r.value = values[r.compiled];
    }
    return { ok: true, ...m };
  } catch (e) {
    return { ok: false, why: String(e && e.message || e) };
  } finally {
    await release(send);
  }
}
