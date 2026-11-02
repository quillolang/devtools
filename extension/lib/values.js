// Quillo's values as they travel, and as the panel writes them.
//
// On the page and on the wire a value is JSON, with three kinds tagged
// (src/client/runtime.js, `untag`): a decimal `{"$dec": "12.50"}`, an int past
// JavaScript's safe range `{"$int": "9007199254740993"}`, and an error value
// `{"$quillo_err": x}`. A state that still holds its prop is written once, as
// `{"$quillo_prop": "name"}`. A server fn's answer is `{"ok": v}` or `{"err": e}`.

export class Dec { constructor(text) { this.text = text; } }
export class Big { constructor(text) { this.text = text; } }
export class Err { constructor(error) { this.error = error; } }
export class PropRef { constructor(name) { this.name = name; } }

const one = (v, k) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && Object.prototype.hasOwnProperty.call(v, k);

// JSON as Quillo means it: the tagged kinds made into the classes above.
export function untag(v) {
  if (Array.isArray(v)) return v.map(untag);
  if (!v || typeof v !== "object") return v;
  if (one(v, "$dec") && typeof v.$dec === "string") return new Dec(v.$dec);
  if (one(v, "$int") && typeof v.$int === "string") return new Big(v.$int);
  if (one(v, "$quillo_err")) return new Err(untag(v.$quillo_err));
  if (one(v, "$quillo_prop") && typeof v.$quillo_prop === "string") return new PropRef(v.$quillo_prop);
  const o = {};
  for (const k of Object.keys(v)) Object.defineProperty(o, k, { value: untag(v[k]), enumerable: true, writable: true, configurable: true });
  return o;
}

// JSON text, read as Quillo's; text that is not JSON stays as it is, marked.
export function parse(text) {
  if (text === null || text === undefined) return { ok: false, value: undefined };
  try { return { ok: true, value: untag(JSON.parse(text)) }; } catch (_) { return { ok: false, value: String(text) }; }
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const keyText = (k) => (NAME.test(k) ? k : JSON.stringify(k));

// A value in one line, written as Quillo writes it: `"text"`, `12.50`, `[1, 2]`,
// `{ name: "x" }`, `err("why")`; cut to `max` characters.
export function show(v, max = 120) {
  const out = text(v, max + 1);
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

function text(v, room) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Dec || v instanceof Big) return v.text;
  if (v instanceof Err) return `err(${text(v.error, room)})`;
  if (v instanceof PropRef) return `(its prop \`${v.name}\`)`;
  if (Array.isArray(v)) {
    const parts = [];
    let used = 2;
    for (const x of v) {
      if (used > room) { parts.push("…"); break; }
      const t = text(x, room - used);
      parts.push(t);
      used += t.length + 2;
    }
    return `[${parts.join(", ")}]`;
  }
  if (typeof v === "object") {
    const ks = Object.keys(v);
    if (!ks.length) return "{}";
    const parts = [];
    let used = 4;
    for (const k of ks) {
      if (used > room) { parts.push("…"); break; }
      const t = `${keyText(k)}: ${text(v[k], room - used)}`;
      parts.push(t);
      used += t.length + 2;
    }
    return `{ ${parts.join(", ")} }`;
  }
  return String(v);
}

// What kind a value is, in Quillo's names.
export function kind(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (v instanceof Dec) return "dec";
  if (v instanceof Big) return "int";
  if (v instanceof Err) return "error";
  if (v instanceof PropRef) return "prop";
  if (Array.isArray(v)) return `list (${v.length})`;
  return `map (${Object.keys(v).length})`;
}

// Whether a value opens in the panel (a list or a map with something in it).
export const opens = (v) => !!v && typeof v === "object" && !(v instanceof Dec || v instanceof Big || v instanceof PropRef) &&
  (v instanceof Err ? opens(v.error) : Object.keys(v).length > 0);

// The value back as wire JSON text, for setting a state: what `untag` reads.
export function wire(v) {
  return JSON.stringify(v, function (k, x) {
    const raw = this[k];
    if (raw instanceof Dec) return { $dec: raw.text };
    if (raw instanceof Big) return { $int: raw.text };
    if (raw instanceof Err) return { $quillo_err: raw.error };
    return x;
  });
}

// What someone typed to set a state, in Quillo's way of writing values, read
// into wire JSON: JSON, plus `12.50d` for a decimal and `err("why")` for an error.
// Gives { ok, text } or { ok: false, why }.
export function typed(input) {
  const s = String(input).trim();
  if (s === "") return { ok: false, why: "type a value: 3, \"text\", true, null, [1, 2], {\"a\": 1}, 12.50d" };
  const dec = s.match(/^(-?\d+(?:\.\d+)?)d$/);
  if (dec) return { ok: true, text: JSON.stringify({ $dec: dec[1] }) };
  const e = s.match(/^err\(([\s\S]*)\)$/);
  if (e) {
    const inner = typed(e[1]);
    return inner.ok ? { ok: true, text: `{"$quillo_err":${inner.text}}` } : inner;
  }
  try {
    const v = JSON.parse(s);
    if (typeof v === "number" && Number.isInteger(v) && !Number.isSafeInteger(v)) return { ok: true, text: JSON.stringify({ $int: s }) };
    return { ok: true, text: JSON.stringify(v) };
  } catch (_) {
    return { ok: false, why: "not a value: write text in double quotes (\"text\"), a decimal as 12.50d" };
  }
}
