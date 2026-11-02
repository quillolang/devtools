// lib/state.js against a protocol that is played here: each command answered as
// Chrome answers it. The real one is in tests/browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readState, setState } from "../../extension/lib/state.js";

// A protocol with the runtime's scope holding `vars`, and `call` answering the
// final Runtime.callFunctionOn.
function protocol({ resume = "function", entry = "window.__quillo_resume", scopes = true, vars = ["Inst", "Live", "toJSON", "untagDeep"], globals = [], call, throws } = {}) {
  const sent = [];
  const send = async (method, params) => {
    sent.push([method, params]);
    if (throws === method) throw new Error("Target closed");
    switch (method) {
      case "Runtime.evaluate": {
        if (params.expression.startsWith("window")) return { result: params.expression === entry ? { type: resume, objectId: "fn" } : { type: "undefined" } };
        const name = params.expression.match(/^typeof (\w+) ===/)[1];
        return { result: globals.includes(name) ? { type: "function", objectId: `global:${name}` } : { type: "undefined" } };
      }
      case "Runtime.getProperties":
        if (params.objectId === "fn") return { internalProperties: scopes ? [{ name: "[[Scopes]]", value: { objectId: "scopes" } }] : [] };
        if (params.objectId === "scopes") return { result: [{ name: "0", value: { objectId: "closure", description: "Closure" } }, { name: "1", value: { objectId: "global", description: "Global" } }, { name: "length", value: { value: 2 } }] };
        if (params.objectId === "closure") return { result: [...vars.map((n) => ({ name: n, value: { objectId: `id:${n}` } })), { name: "BASE", value: { value: "" } }] };
        throw new Error("the global scope is not read");
      case "Runtime.callFunctionOn":
        if (params.objectId === "id:Inst") return { result: { objectId: "proto" } };
        return call(params);
      case "Runtime.queryObjects": return { objects: { objectId: "all" } };
      case "Runtime.releaseObjectGroup": return {};
    }
    throw new Error("unexpected " + method);
  };
  return { send, sent };
}

test("reads the components, sorted by island, and lets go of what it held", async () => {
  const p = protocol({ call: (params) => {
    assert.deepEqual(params.arguments, [{ objectId: "id:toJSON" }, { objectId: "id:Live" }]);
    return { result: { value: [{ index: 1, name: "Inner" }, { index: 0, name: "Counter" }] } };
  } });
  const r = await readState(p.send);
  assert.deepEqual(r, { ok: true, components: [{ index: 0, name: "Counter" }, { index: 1, name: "Inner" }] });
  assert.equal(p.sent.at(-1)[0], "Runtime.releaseObjectGroup");
});

test("a runtime that has only Inst is read with plain JSON", async () => {
  const p = protocol({ vars: ["Inst"], call: (params) => {
    assert.deepEqual(params.arguments, [{ value: null }, { value: null }]);
    return { result: { value: [] } };
  } });
  assert.deepEqual(await readState(p.send), { ok: true, components: [] });
});

test("under --watch the runtime's functions are globals, and are found there", async () => {
  const p = protocol({ vars: ["Inst", "Live"], globals: ["toJSON", "untagDeep"], call: (params) => {
    assert.deepEqual(params.arguments, [{ objectId: "global:toJSON" }, { objectId: "id:Live" }]);
    return { result: { value: [] } };
  } });
  assert.deepEqual(await readState(p.send), { ok: true, components: [] });
  // Live and Inst are not looked for as globals once found in the closure.
  const asked = p.sent.filter(([m]) => m === "Runtime.evaluate").map(([, x]) => x.expression.replace(/^typeof (\w+) .*/, "$1"));
  assert.deepEqual(asked, ["window.__quillo_resume", "toJSON", "untagDeep"]);
});

test("a runtime with no __quillo_resume (0.6.0) is reached through quillo.rpc or __quillo_rt", async () => {
  for (const entry of ["window.quillo && window.quillo.rpc", "window.__quillo_rt && Object.values(window.__quillo_rt).find((f) => typeof f === 'function')"]) {
    const p = protocol({ entry, call: () => ({ result: { value: [{ index: 0, name: "A" }] } }) });
    assert.deepEqual(await readState(p.send), { ok: true, components: [{ index: 0, name: "A" }] });
  }
});

test("with no entry, the runtime's own names are looked for as globals (--watch)", async () => {
  const p = protocol({ resume: "undefined", globals: ["Inst"], call: () => ({ result: { value: [] } }) });
  // Inst as a global is a class: found, and the protocol is asked for its prototype.
  const sent = [];
  const send = (m, x) => { sent.push(m); return m === "Runtime.callFunctionOn" && x.objectId === "global:Inst" ? Promise.resolve({ result: { objectId: "proto" } }) : p.send(m, x); };
  assert.deepEqual(await readState(send), { ok: true, components: [] });
});

test("says why it cannot read", async () => {
  assert.match((await readState(protocol({ resume: "undefined" }).send)).why, /has not started/);
  assert.match((await readState(protocol({ scopes: false }).send)).why, /closure/);
  const old = await readState(protocol({ vars: ["Live"] }).send);
  assert.deepEqual(old.missing, ["Inst"]);
  assert.match(old.why, /no `Inst`/);
  assert.equal((await readState(protocol({ call: () => ({ exceptionDetails: { exception: { description: "TypeError: x" } } }) }).send)).why, "TypeError: x");
  assert.equal((await readState(protocol({ call: () => ({ exceptionDetails: { text: "Uncaught" } }) }).send)).why, "Uncaught");
  assert.equal((await readState(protocol({ throws: "Runtime.queryObjects" }).send)).why, "Target closed");
});

test("sets a state, and says why it could not", async () => {
  const ok = protocol({ call: (params) => {
    assert.deepEqual(params.arguments, [{ objectId: "id:untagDeep" }, { value: 2 }, { value: "n" }, { value: "5" }]);
    return { result: { value: "" } };
  } });
  assert.deepEqual(await setState(ok.send, 2, "n", "5"), { ok: true });
  assert.deepEqual(await setState(protocol({ call: () => ({ result: { value: "it has no state x" } }) }).send, 0, "x", "1"), { ok: false, why: "it has no state x" });
  assert.equal((await setState(protocol({ call: () => ({ exceptionDetails: { exception: { description: "SyntaxError" } } }) }).send, 0, "n", "{")).why, "SyntaxError");
  assert.equal((await setState(protocol({ call: () => ({ exceptionDetails: { text: "Uncaught" } }) }).send, 0, "n", "{")).why, "Uncaught");
  assert.match((await setState(protocol({ resume: "undefined" }).send, 0, "n", "1")).why, /has not started/);
  assert.equal((await setState(protocol({ throws: "Runtime.evaluate" }).send, 0, "n", "1")).why, "Target closed");
  const plain = protocol({ vars: ["Inst"], call: (params) => { assert.deepEqual(params.arguments[0], { value: null }); return { result: { value: "" } }; } });
  assert.deepEqual(await setState(plain.send, 0, "n", "1"), { ok: true });
});
