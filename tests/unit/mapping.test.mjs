// lib/mapping.js: its reading of compiled code, on code Quillo compiled (0.6.0, main),
// and readMapping against a protocol played here. The real one is in tests/browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nameOf, balanced, statementEnd, depths, declarations, reads, readMapping } from "../../extension/lib/mapping.js";

// As Quillo compiles them (production joins some lines; the reading must not care).
const PARENT = `function ($i, $p) {
$p = W.props($p, {"title": () => ("parent")});
W.argty($p.title, ["str"], false, "title", "Parent");
let $bump_6, $greeting_5, $suffix_7;
const $a_2 = $i.sig("a", () => { return 1; });
const $b_3 = $i.sig("b", () => { return 2; });
const $double_4 = W.memo(() => (W.mul($a_2.v, 2)));
$greeting_5 = "hi";
$bump_6 = function () {
if (arguments.length > 0) W.arity(arguments.length, 0, "<fn>");
$a_2.set(W.add($a_2.v, 1));
return null;
};
$suffix_7 = "!";
const $shout_8 = W.memo(() => (W.add($p.title, $suffix_7)));
return W.t($b1, [$bump_6, $greeting_5, () => ($double_4.v), W.c(G["Child"], {get "value"() { return $a_2.v; }, "fixed": 7}, null)]);
}`;

const COUNTER = `function ($i, $p) {const $n_2 = $i.sig("n", () => { return $p.start; });const $items_4 = W.live($i, "items", "list_tasks", () => []);
return W.t($b0, [async function () { let $l_7; $l_7 = [1, 2]; $n_2.set(W.add(W.index($l_7, 5), 1)); return null; }]);
}`;

const PATTERN = `function ($i, $p) {
let $t0;
let $p_2, $q_3, $tags_4;
const $a_1 = $i.sig("a", () => { return 1; });
$t0 = [1, 2];
if (!(Array.isArray($t0) && $t0.length === 2)) W.fail("\`let\` pattern does not match " + W.short($t0));
$p_2 = $t0[0];
$q_3 = $t0[1];
$tags_4 = ["x", "y"];
const $count_5 = W.memo(() => (W.add(B.len($tags_4), $a_1.v)));
return W.t($b0, [$p_2, $q_3, () => ($count_5.v)]);
}`;

test("nameOf gives a compiled name's own", () => {
  assert.equal(nameOf("$double_4"), "double");
  assert.equal(nameOf("$my_var_12"), "my_var");
  assert.equal(nameOf("$t0"), "$t0");
});

test("balanced and statementEnd mind strings and brackets", () => {
  const t = 'W.memo(() => (f(")", "\\"(")))); next';
  assert.equal(balanced(t, 7), '() => (f(")", "\\"("))');
  assert.equal(balanced("(a", 1), null);
  assert.equal(balanced("`a)` )", 0), "`a)` ");
  const s = 'x = g("a;b", { c: 1 }); y = 2';
  assert.equal(s.slice(0, statementEnd(s, 0)), 'x = g("a;b", { c: 1 })');
  assert.equal(statementEnd("{ x = 1 }", 2), 8);
  assert.equal(statementEnd("x = 'a\\'b'", 0), 10);
  assert.equal(statementEnd("x = 1", 0), 5);
});

test("depths counts brackets, not those in strings", () => {
  const t = 'f("(\\"[", [1]) {}';
  const d = depths(t);
  assert.equal(d[0], 0);
  assert.equal(d[3], 1);
  assert.equal(d[11], 2);
  assert.equal(d[t.length - 1], 0);
  assert.equal(d[t.length], 0);
});

test("declarations: states, live states, derived lets, lets and functions", () => {
  const p = declarations(PARENT);
  assert.deepEqual(Object.fromEntries(Object.entries(p).map(([c, d]) => [c, [d.name, d.kind]])), {
    $a_2: ["a", "state"], $b_3: ["b", "state"], $double_4: ["double", "derived"], $shout_8: ["shout", "derived"],
    $bump_6: ["bump", "function"], $greeting_5: ["greeting", "let"], $suffix_7: ["suffix", "let"],
  });
  assert.equal(p.$double_4.text, "() => (W.mul($a_2.v, 2))");
  assert.equal(p.$greeting_5.text, '"hi"');
  // A handler's own let is not the component's.
  const c = declarations(COUNTER);
  assert.deepEqual(Object.keys(c), ["$n_2", "$items_4"]);
  assert.deepEqual([c.$items_4.kind, c.$items_4.fn], ["live", "list_tasks"]);
  // A pattern's lets come from a temporary, which is not one.
  const t = declarations(PATTERN);
  assert.deepEqual(Object.keys(t), ["$a_1", "$count_5", "$p_2", "$q_3", "$tags_4"]);
  assert.equal(t.$p_2.text, "$t0[0]");
  // A let with no assignment the component makes, arrow functions, a quoted name.
  const odd = declarations(`function ($i, $p) {
let $z_1, $f_2, $g_3, $h_4;
if (W.truthy(x)) { $z_1 = 1; }
$f_2 = async ($e) => null;
$g_3 = $e => 1;
$h_4 = async function () {};
const $q_5 = $i.sig("say \\"hi\\"", () => { return 1; });
}`);
  assert.deepEqual(Object.fromEntries(Object.entries(odd).map(([k, d]) => [k, [d.name, d.kind, d.text]])), {
    $q_5: ['say "hi"', "state", undefined], $z_1: ["z", "let", null], $f_2: ["f", "function", null], $g_3: ["g", "function", null], $h_4: ["h", "function", null],
  });
});

test("reads: the locals and props a piece of code reads", () => {
  assert.deepEqual(reads("W.add($a_2.v, $p.title) + $a_2.v + $p[\"two words\"] + $row_10.v + $t0"), { locals: ["$a_2", "$row_10"], props: ["title", "two words"] });
  assert.deepEqual(reads(undefined), { locals: [], props: [] });
});

// A protocol whose runtime has `Inst`, whose component answers `mapping`, and whose
// closures hold `graph` (objectId → getProperties answer) and `json` (objectId → the
// value's JSON text).
function protocol({ mapping, graph = {}, json = {}, page, throws } = {}) {
  const sent = [];
  const base = {
    fn: { internalProperties: [{ name: "[[Scopes]]", value: { objectId: "scopes" } }] },
    scopes: { result: [{ name: "0", value: { objectId: "closure", description: "Closure" } }] },
    closure: { result: [{ name: "Inst", value: { objectId: "id:Inst" } }] },
  };
  const send = async (method, params) => {
    sent.push([method, params]);
    if (throws === method) throw new Error("Target closed");
    if (method === "Runtime.evaluate") return { result: params.expression === "window.__quillo_resume" ? { type: "function", objectId: "fn" } : { type: "undefined" } };
    if (method === "Runtime.getProperties") return graph[params.objectId] || base[params.objectId] || { result: [] };
    if (method === "Runtime.queryObjects") return { objects: { objectId: "all" } };
    if (method === "Runtime.releaseObjectGroup") return {};
    if (params.objectId === "id:Inst") return { result: { objectId: "proto" } };
    if (params.functionDeclaration.startsWith("function (toJSON, index)")) return page || { result: { value: mapping } };
    if (params.functionDeclaration.startsWith("function (index)")) return { result: { objectId: "list" } };
    return json[params.objectId] === undefined ? {} : { result: { value: json[params.objectId] } };
  };
  return { send, sent };
}

const v = (compiled, kind, extra = {}) => ({ compiled, name: nameOf(compiled), kind, value: null, reads: [], ...extra });

test("readMapping: lets' values found in the closures the component keeps", async () => {
  const mapping = {
    index: 3, name: "P", props: [],
    vars: [v("$x_1", "let"), v("$u_2", "let"), v("$w_3", "let"), v("$o_5", "let"), v("$o_6", "let"), v("$late_7", "let"), v("$none_9", "let"), v("$s_10", "let"), v("$sym_11", "let"),
      v("$d_8", "derived", { reads: [{ owner: 3, compiled: "$x_1", kind: "let" }, { owner: 1, compiled: "$x_1", kind: "let" }, { owner: 3, kind: "prop" }] })],
  };
  const fn = (id, scope) => ({ internalProperties: [{ name: "[[Scopes]]", value: { objectId: scope } }] });
  const graph = {
    list: { result: [{ name: "0", value: { objectId: "f1" } }, { name: "1", value: { objectId: "f1" } }, { name: "2", value: { objectId: "f2" } }, { name: "length", value: { value: 3 } }] },
    f1: fn("f1", "s1"),
    f2: { internalProperties: [] },
    s1: { result: [{ name: "0", value: { objectId: "c1", description: "Closure" } }, { name: "1", value: { objectId: "g", description: "Global" } }] },
    c1: { result: [
      { name: "$x_1", value: { type: "number", value: 5 } },
      { name: "$u_2", value: { type: "undefined" } },
      { name: "$w_3", value: { type: "function", objectId: "fw" } },
      { name: "$o_5", value: { type: "object", objectId: "o1" } },
      { name: "$o_6", value: { type: "object", objectId: "o2" } },
      { name: "$s_10" },
      { name: "$sym_11", value: { type: "symbol", description: "Symbol()" } },
      { name: "$h_4", value: { type: "function", objectId: "f3" } },
      { name: "$x_1", value: { type: "number", value: 6 } },
    ] },
    f3: fn("f3", "s3"),
    s3: { result: [{ name: "0", value: { objectId: "c3", description: "Closure" } }] },
    c3: { result: [{ name: "$late_7", value: { type: "string", value: "late" } }] },
  };
  const p = protocol({ mapping, graph, json: { o1: '["a"]' } });
  const r = await readMapping(p.send, 3);
  assert.equal(r.ok, true);
  const got = Object.fromEntries(r.vars.map((x) => [x.name, [x.value, x.kept || false]]));
  assert.deepEqual(got, {
    x: ["5", true], u: ["null", true], w: [null, true], o: [null, true], late: ['"late"', true], none: [null, false], s: ["null", true], sym: ["null", true], d: [null, false],
  });
  // Only the one $o_5 read: the second object answered nothing.
  assert.equal(r.vars.find((x) => x.compiled === "$o_5").value, '["a"]');
  assert.deepEqual(r.vars.find((x) => x.kind === "derived").reads.map((x) => x.value), ["5", undefined, undefined]);
  assert.equal(p.sent.at(-1)[0], "Runtime.releaseObjectGroup");
  // Each closure read once.
  assert.equal(p.sent.filter(([m, x]) => m === "Runtime.getProperties" && x.objectId === "f1").length, 1);
});

test("readMapping: no lets, nothing more asked; and why it cannot read", async () => {
  const p = protocol({ mapping: { index: 0, name: "Q", props: [], vars: [v("$a_1", "state")] } });
  assert.deepEqual(await readMapping(p.send, 0), { ok: true, index: 0, name: "Q", props: [], vars: [v("$a_1", "state")] });
  assert.equal(p.sent.some(([, x]) => x && x.functionDeclaration && x.functionDeclaration.startsWith("function (index)")), false);
  assert.deepEqual(await readMapping(protocol({ mapping: null }).send, 9), { ok: false, why: "no component there any more" });
  assert.equal((await readMapping(protocol({ page: { exceptionDetails: { exception: { description: "TypeError: x" } } } }).send, 0)).why, "TypeError: x");
  assert.equal((await readMapping(protocol({ page: { exceptionDetails: { text: "Uncaught" } } }).send, 0)).why, "Uncaught");
  assert.equal((await readMapping(protocol({ throws: "Runtime.queryObjects" }).send, 0)).why, "Target closed");
  const none = protocol();
  const send = (m, x) => (m === "Runtime.evaluate" ? Promise.resolve({ result: { type: "undefined" } }) : none.send(m, x));
  assert.match((await readMapping(send, 0)).why, /has not started/);
});
