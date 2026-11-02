// Server fn calls, read from what DevTools' Network panel records (a HAR entry and
// its body). Each call is `POST <mount>/_quillo/rpc/<name>`, its arguments a JSON
// array, or, with a file among them, a multipart body whose `args` part is that array
// (src/client/runtime.js, `rpcRaw`). Headers say more:
//
//   x-quillo-live: 1      a `live(...)` state loading again (after a change, or new arguments)
//   x-quillo-had: <h>     ...which has the answer whose hash is h: the answer may be a patch to it
//   idempotency-key: <k>  a call sent at most once (`idempotent`): resent with the same key
//
// The answer is `{"ok": v}` or `{"err": e}` (with `topics`, the tables and globals the
// call read, and `seq`), `{"patch": p}` to a live state's last value, or an error
// status with `{"error": "..."}`.

import { parse, untag } from "./values.js";

const RPC = /^(.*)\/_quillo\/rpc\/([^/?#]+)$/;

// The server fn a URL calls, or null.
export function rpcName(url) {
  let path;
  try { path = new URL(url).pathname; } catch (_) { return null; }
  const m = path.match(RPC);
  if (!m) return null;
  try { return decodeURIComponent(m[2]); } catch (_) { return m[2]; }
}

const header = (list, name) => {
  const h = (list || []).find((x) => x.name.toLowerCase() === name);
  return h ? h.value : null;
};

// The `args` part of a multipart body.
export function multipartArgs(text) {
  const m = String(text || "").match(/name="args"\r?\n(?:[^\r\n]+\r?\n)*\r?\n([\s\S]*?)\r?\n--/);
  return m ? m[1] : null;
}

// A call from a HAR entry and the text of its answer; null for another request.
export function fromHar(entry, body) {
  const req = entry.request || {}, res = entry.response || {};
  const name = rpcName(req.url || "");
  if (!name || (req.method || "").toUpperCase() !== "POST") return null;
  const post = req.postData || {};
  const multipart = /multipart\/form-data/i.test(post.mimeType || header(req.headers, "content-type") || "");
  const argText = multipart ? multipartArgs(post.text) : post.text;
  const args = parse(argText);
  const files = multipart ? ((post.text || "").match(/name="file\d+"/g) || []).length : 0;
  const status = res.status || 0;
  const answer = answerOf(status, body);
  return {
    name,
    url: req.url,
    started: entry.startedDateTime || null,
    ms: typeof entry.time === "number" ? Math.round(entry.time * 10) / 10 : null,
    status,
    args: args.ok && Array.isArray(args.value) ? args.value : null,
    argsText: args.ok ? null : argText || "",
    files,
    live: header(req.headers, "x-quillo-live") === "1",
    had: header(req.headers, "x-quillo-had"),
    idem: header(req.headers, "idempotency-key"),
    request: header(res.headers, "x-request-id"),
    ...answer,
  };
}

// What the answer was: `kind` is ok, err (an error value the fn gave), patch (to a
// live state's last value), failed (an error status), or none (no body: the call
// was cut off, or the page went away first).
export function answerOf(status, body) {
  if (body === null || body === undefined || body === "") return { kind: status ? "failed" : "none", value: null, error: status ? `status ${status}` : null, topics: [], seq: 0 };
  let j;
  try { j = JSON.parse(body); } catch (_) { return { kind: "failed", value: null, error: String(body).slice(0, 500), topics: [], seq: 0 }; }
  const meta = { topics: Array.isArray(j && j.topics) ? j.topics : [], seq: (j && j.seq) || 0 };
  if (status >= 400 || !j || typeof j !== "object") return { kind: "failed", value: null, error: (j && j.error) || `status ${status}`, ...meta };
  if (Object.prototype.hasOwnProperty.call(j, "patch")) return { kind: "patch", value: j.patch, error: null, ...meta };
  if (Object.prototype.hasOwnProperty.call(j, "err")) return { kind: "err", value: untag(j.err), error: null, ...meta };
  return { kind: "ok", value: Object.prototype.hasOwnProperty.call(j, "ok") ? untag(j.ok) : null, error: null, ...meta };
}

// A short word for a call's flags, for the list.
export function flags(c) {
  const f = [];
  if (c.live) f.push(c.had ? "live reload (has answer)" : "live load");
  if (c.idem) f.push("once");
  if (c.files) f.push(c.files === 1 ? "1 file" : `${c.files} files`);
  return f;
}
