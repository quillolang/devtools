import { test } from "node:test";
import assert from "node:assert/strict";
import { describe } from "../../extension/lib/live.js";

const ev = (kind, path, more) => ({ kind, at: 1, id: 1, path, ...more });

test("the live socket: what it follows, and what changed", () => {
  const open = describe(ev("ws-open", "/_quillo/live", { query: "?since=3&s=ab&t=db%3Atasks%2Cg%3Acount" }));
  assert.equal(open.what, "follows");
  assert.deepEqual(open.topics, ["db:tasks", "g:count"]);
  assert.equal(open.detail, "2 topics, from change 3");
  assert.equal(describe(ev("ws-open", "/_quillo/live", { query: "?t=db%3Atasks" })).detail, "1 topic, from change 0");
  assert.deepEqual(describe(ev("ws-open", "/_quillo/live", {})).topics, []);
  const changed = describe(ev("ws-in", "/_quillo/live", { data: '{"seq":4,"server":"ab","changed":["db:tasks"]}' }));
  assert.equal(changed.what, "changed");
  assert.equal(changed.dir, "in");
  assert.equal(changed.seq, 4);
  assert.deepEqual(changed.changed, ["db:tasks"]);
  assert.equal(describe(ev("ws-in", "/_quillo/live", { data: '{"seq":4}' })).detail, "(nothing)");
  assert.equal(describe(ev("ws-in", "/_quillo/live", { data: "nope" })).seq, null);
  assert.equal(describe(ev("ws-close", "/_quillo/live", { code: 1006 })).detail, "code 1006");
});

test("--watch's socket: reloads and stylesheets", () => {
  assert.equal(describe(ev("ws-open", "/_quillo/events")).what, "watching");
  assert.deepEqual([describe(ev("ws-in", "/_quillo/events", { data: "7" })).what, describe(ev("ws-in", "/_quillo/events", { data: "7" })).detail], ["reload", "version 7"]);
  const css = describe(ev("ws-in", "/_quillo/events", { data: 'css:3:["/app.css"]' }));
  assert.equal(css.what, "styles");
  assert.equal(css.detail, '["/app.css"]');
});

test("channels over a WebSocket", () => {
  assert.equal(describe(ev("ws-open", "/_quillo/wt")).what, "channels");
  assert.equal(describe(ev("ws-out", "/_quillo/wt", { data: '["j","room"]' })).what, "join");
  assert.equal(describe(ev("ws-out", "/_quillo/wt", { data: '["j","room"]' })).dir, "out");
  assert.equal(describe(ev("ws-in", "/_quillo/wt", { data: '["j","room",true]' })).what, "joined");
  assert.equal(describe(ev("ws-in", "/_quillo/wt", { data: '["j","room",false]' })).what, "refused");
  assert.equal(describe(ev("ws-out", "/_quillo/wt", { data: '["l","room"]' })).what, "leave");
  assert.equal(describe(ev("ws-out", "/_quillo/wt", { data: '["v","cam"]' })).what, "watch media");
  const m = describe(ev("ws-in", "/_quillo/wt", { data: '["m","room",{"x":1}]' }));
  assert.deepEqual([m.what, m.channel, m.value], ["message", "room", { x: 1 }]);
  assert.equal(describe(ev("ws-in", "/_quillo/wt", { data: "(12 bytes)" })).what, "frame");
  assert.equal(describe(ev("ws-in", "/_quillo/wt", { data: '["z","x"]' })).what, "frame");
  assert.equal(describe(ev("ws-in", undefined, {})).what, "frame");
});
