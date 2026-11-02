import { test } from "node:test";
import assert from "node:assert/strict";
import { rpcName, multipartArgs, fromHar, answerOf, flags } from "../../extension/lib/calls.js";
import { Dec } from "../../extension/lib/values.js";

const entry = (over = {}) => ({
  startedDateTime: "2026-11-02T05:00:00.000Z",
  time: 12.345,
  request: { url: "http://127.0.0.1:8080/_quillo/rpc/add_task", method: "POST", headers: [{ name: "Content-Type", value: "application/json" }], postData: { mimeType: "application/json", text: '["milk"]' }, ...over.request },
  response: { status: 200, headers: [{ name: "x-request-id", value: "abc" }], ...over.response },
});

test("rpcName finds the server fn a URL calls, under a mount too", () => {
  assert.equal(rpcName("http://h/_quillo/rpc/list_tasks"), "list_tasks");
  assert.equal(rpcName("http://h/shop/_quillo/rpc/pay"), "pay");
  assert.equal(rpcName("http://h/_quillo/rpc/a%20b"), "a b");
  assert.equal(rpcName("http://h/_quillo/rpc/%E0%A4%A"), "%E0%A4%A");
  assert.equal(rpcName("http://h/_quillo/live"), null);
  assert.equal(rpcName("http://h/_quillo/rpc/"), null);
  assert.equal(rpcName("not a url"), null);
});

test("a call and its answer", () => {
  const c = fromHar(entry(), '{"ok":[{"id":1,"price":{"$dec":"2.50"}}],"topics":["db:tasks"],"seq":4}');
  assert.equal(c.name, "add_task");
  assert.deepEqual(c.args, ["milk"]);
  assert.equal(c.argsText, null);
  assert.equal(c.ms, 12.3);
  assert.equal(c.status, 200);
  assert.equal(c.kind, "ok");
  assert.ok(c.value[0].price instanceof Dec);
  assert.deepEqual(c.topics, ["db:tasks"]);
  assert.equal(c.seq, 4);
  assert.equal(c.request, "abc");
  assert.equal(c.live, false);
  assert.equal(c.idem, null);
  assert.deepEqual(flags(c), []);
});

test("an error value, a patch, a failure, no answer", () => {
  assert.deepEqual(fromHar(entry(), '{"err":"a task needs some text"}').value, "a task needs some text");
  assert.equal(fromHar(entry(), '{"err":"x"}').kind, "err");
  const p = fromHar(entry(), '{"patch":{"$=":1},"topics":[],"seq":2}');
  assert.equal(p.kind, "patch");
  assert.deepEqual(p.value, { "$=": 1 });
  const f = fromHar(entry({ response: { status: 500 } }), '{"error":"internal error"}');
  assert.equal(f.kind, "failed");
  assert.equal(f.error, "internal error");
  assert.equal(fromHar(entry({ response: { status: 502 } }), "Bad Gateway").error, "Bad Gateway");
  assert.equal(fromHar(entry({ response: { status: 503 } }), "").error, "status 503");
  assert.equal(fromHar(entry({ response: { status: 0 } }), null).kind, "none");
  assert.equal(fromHar(entry(), "null").kind, "failed");
  assert.equal(fromHar(entry(), '{"x":1}').value, null);
});

test("a live load, a live reload with its answer, a call sent once", () => {
  const live = fromHar(entry({ request: { headers: [{ name: "x-quillo-live", value: "1" }] } }), '{"ok":[]}');
  assert.equal(live.live, true);
  assert.deepEqual(flags(live), ["live load"]);
  const had = fromHar(entry({ request: { headers: [{ name: "X-Quillo-Live", value: "1" }, { name: "x-quillo-had", value: "h1" }] } }), '{"ok":[]}');
  assert.deepEqual(flags(had), ["live reload (has answer)"]);
  const once = fromHar(entry({ request: { headers: [{ name: "idempotency-key", value: "k1" }] } }), '{"ok":1}');
  assert.equal(once.idem, "k1");
  assert.deepEqual(flags(once), ["once"]);
});

test("files: the arguments are the multipart body's args part", () => {
  const text = '------b\r\nContent-Disposition: form-data; name="args"\r\n\r\n[{"$quillo_file":0},"note"]\r\n------b\r\nContent-Disposition: form-data; name="file0"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n(binary)\r\n------b\r\nContent-Disposition: form-data; name="file1"; filename="b.png"\r\n\r\nx\r\n------b--\r\n';
  const c = fromHar(entry({ request: { headers: [{ name: "content-type", value: "multipart/form-data; boundary=----b" }], postData: { mimeType: "multipart/form-data; boundary=----b", text } } }), '{"ok":null}');
  assert.deepEqual(c.args, [{ $quillo_file: 0 }, "note"]);
  assert.equal(c.files, 2);
  assert.deepEqual(flags(c), ["2 files"]);
  assert.deepEqual(flags({ ...c, files: 1 }), ["1 file"]);
  assert.equal(multipartArgs(""), null);
  assert.equal(multipartArgs(undefined), null);
  // No post data that can be read (a large body): the text, or nothing.
  const none = fromHar(entry({ request: { postData: undefined, headers: [] } }), '{"ok":1}');
  assert.equal(none.args, null);
  assert.equal(none.argsText, "");
  const bad = fromHar(entry({ request: { postData: { mimeType: "application/json", text: "[1," } } }), '{"ok":1}');
  assert.equal(bad.argsText, "[1,");
  const notList = fromHar(entry({ request: { postData: { mimeType: "application/json", text: "{}" } } }), '{"ok":1}');
  assert.equal(notList.args, null);
});

test("only a POST to /_quillo/rpc/ is a call", () => {
  assert.equal(fromHar(entry({ request: { method: "GET" } }), ""), null);
  assert.equal(fromHar(entry({ request: { url: "http://h/api" } }), ""), null);
  assert.equal(fromHar({}, ""), null);
  const noTime = fromHar({ ...entry(), time: undefined, startedDateTime: undefined }, '{"ok":1}');
  assert.equal(noTime.ms, null);
  assert.equal(noTime.started, null);
});

test("answerOf on its own", () => {
  assert.deepEqual(answerOf(200, undefined), { kind: "failed", value: null, error: "status 200", topics: [], seq: 0 });
  assert.equal(answerOf(200, '{"ok":1,"topics":"x"}').topics.length, 0);
  assert.equal(answerOf(404, '{"ok":1}').kind, "failed");
});
