import { test } from "node:test";
import assert from "node:assert/strict";
import { Dec, Big, Err, PropRef, untag, parse, show, kind, opens, wire, typed, keyText } from "../../extension/lib/values.js";

test("untag makes Quillo's tagged values, deep", () => {
  const v = untag({ price: { $dec: "12.50" }, big: { $int: "9007199254740993" }, e: { $quillo_err: { $dec: "1" } }, p: { $quillo_prop: "initial" }, l: [{ $dec: "2" }], n: null });
  assert.ok(v.price instanceof Dec && v.price.text === "12.50");
  assert.ok(v.big instanceof Big && v.big.text === "9007199254740993");
  assert.ok(v.e instanceof Err && v.e.error instanceof Dec);
  assert.ok(v.p instanceof PropRef && v.p.name === "initial");
  assert.ok(v.l[0] instanceof Dec);
  assert.equal(v.n, null);
  // Not tags: more than one key, or the wrong type inside.
  assert.deepEqual(untag({ $dec: "1", x: 1 }), { $dec: "1", x: 1 });
  assert.deepEqual(untag({ $dec: 1 }), { $dec: 1 });
  assert.deepEqual(untag({ $int: 5 }), { $int: 5 });
  assert.deepEqual(untag({ $quillo_prop: 5 }), { $quillo_prop: 5 });
  // A key that is a property of every object stays a key of this one.
  const o = untag(JSON.parse('{"__proto__": 1, "constructor": 2}'));
  assert.equal(Object.getPrototypeOf(o), Object.prototype);
  assert.deepEqual(Object.keys(o), ["__proto__", "constructor"]);
});

test("parse reads JSON text, and keeps what is not JSON as text", () => {
  assert.deepEqual(parse('{"a":1}'), { ok: true, value: { a: 1 } });
  assert.deepEqual(parse("{"), { ok: false, value: "{" });
  assert.deepEqual(parse(null), { ok: false, value: undefined });
  assert.deepEqual(parse(undefined), { ok: false, value: undefined });
});

test("show writes a value as Quillo does, cut to its room", () => {
  assert.equal(show(null), "null");
  assert.equal(show(undefined), "null");
  assert.equal(show("a\"b"), '"a\\"b"');
  assert.equal(show(3), "3");
  assert.equal(show(true), "true");
  assert.equal(show(new Dec("12.50")), "12.50");
  assert.equal(show(new Big("9007199254740993")), "9007199254740993");
  assert.equal(show(new Err("why")), 'err("why")');
  assert.equal(show(new PropRef("initial")), "(its prop `initial`)");
  assert.equal(show([1, "a"]), '[1, "a"]');
  assert.equal(show({}), "{}");
  assert.equal(show({ name: "x", "two words": 1 }), '{ name: "x", "two words": 1 }');
  const long = show(Array.from({ length: 100 }, (_, i) => i), 30);
  assert.equal(long.length, 30);
  assert.ok(long.endsWith("…"));
  const wide = show(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])), 40);
  assert.equal(wide.length, 40);
  assert.equal(show(Symbol.for("x")), "Symbol(x)");
});

test("kind names a value's type in Quillo's words", () => {
  assert.equal(kind(null), "null");
  assert.equal(kind("s"), "str");
  assert.equal(kind(false), "bool");
  assert.equal(kind(1), "int");
  assert.equal(kind(1.5), "float");
  assert.equal(kind(new Dec("1")), "dec");
  assert.equal(kind(new Big("1")), "int");
  assert.equal(kind(new Err(1)), "error");
  assert.equal(kind(new PropRef("p")), "prop");
  assert.equal(kind([1, 2]), "list (2)");
  assert.equal(kind({ a: 1 }), "map (1)");
});

test("opens: lists and maps with something in them, and errors holding one", () => {
  assert.equal(opens([1]), true);
  assert.equal(opens([]), false);
  assert.equal(opens({}), false);
  assert.equal(opens({ a: 1 }), true);
  assert.equal(opens(new Dec("1")), false);
  assert.equal(opens(new PropRef("p")), false);
  assert.equal(opens(new Err("x")), false);
  assert.equal(opens(new Err({ code: 1 })), true);
  assert.equal(opens(null), false);
  assert.equal(opens("s"), false);
});

test("wire gives a value back as tagged JSON", () => {
  const v = { d: new Dec("1.5"), b: new Big("9007199254740993"), e: new Err("x"), l: [1] };
  assert.equal(wire(v), '{"d":{"$dec":"1.5"},"b":{"$int":"9007199254740993"},"e":{"$quillo_err":"x"},"l":[1]}');
  assert.deepEqual(untag(JSON.parse(wire(v))).d, new Dec("1.5"));
});

test("typed reads what someone types to set a state", () => {
  assert.deepEqual(typed("3"), { ok: true, text: "3" });
  assert.deepEqual(typed(' "text" '), { ok: true, text: '"text"' });
  assert.deepEqual(typed("[1, 2]"), { ok: true, text: "[1,2]" });
  assert.deepEqual(typed("12.50d"), { ok: true, text: '{"$dec":"12.50"}' });
  assert.deepEqual(typed("-3d"), { ok: true, text: '{"$dec":"-3"}' });
  assert.deepEqual(typed('err("no")'), { ok: true, text: '{"$quillo_err":"no"}' });
  assert.deepEqual(typed("9007199254740993"), { ok: true, text: '{"$int":"9007199254740993"}' });
  assert.equal(typed("").ok, false);
  assert.match(typed("text").why, /double quotes/);
  assert.equal(typed("err(nope)").ok, false);
});

test("keyText quotes a key that is not a name", () => {
  assert.equal(keyText("a_1"), "a_1");
  assert.equal(keyText("a b"), '"a b"');
  assert.equal(keyText("1a"), '"1a"');
});
