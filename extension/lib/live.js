// What Quillo's WebSockets carry, as main.js hears it, made readable.
//
//   /_quillo/live    live data: `?since=<seq>&s=<server>&t=<topics>` names what the page
//                    follows; each message is { seq, server, changed: [topics] }, and the
//                    `live(...)` states that read a changed topic load again (as calls
//                    with x-quillo-live, in the Calls tab)
//   /_quillo/wt      channels, when WebTransport is not used: ["j", name] joins,
//                    ["l", name] leaves, ["m", name, value] a message; the server's
//                    ["j", name, true|false] lets the page in or not; binary frames are media
//   /_quillo/events  --watch: the program's version; a new one reloads the page, and
//                    "css:<n>:<paths>" swaps stylesheets in place

import { parse } from "./values.js";

const params = (query) => {
  const p = new URLSearchParams(query || "");
  return { since: p.get("since"), server: p.get("s"), topics: (p.get("t") || "").split(",").filter(Boolean) };
};

// One event of main.js's ("ws-open", "ws-in", "ws-out", "ws-close") as a line:
// { at, socket, dir, what, detail, topics?, changed?, channel? }.
export function describe(e) {
  const base = { at: e.at, socket: e.id, path: e.path, dir: e.kind === "ws-in" ? "in" : e.kind === "ws-out" ? "out" : "" };
  const kind = (e.path || "").replace(/^\/_quillo\//, "");
  if (e.kind === "ws-open") {
    if (kind === "live") {
      const p = params(e.query);
      return { ...base, what: "follows", topics: p.topics, detail: `${p.topics.length} topic${p.topics.length === 1 ? "" : "s"}, from change ${p.since || 0}` };
    }
    if (kind === "events") return { ...base, what: "watching", detail: "--watch: reloads when the program changes" };
    return { ...base, what: "channels", detail: "channels over a WebSocket" };
  }
  if (e.kind === "ws-close") return { ...base, what: "closed", detail: `code ${e.code}` };
  const data = String(e.data || "");
  if (kind === "live") {
    const j = parse(data);
    const changed = j.ok && j.value && Array.isArray(j.value.changed) ? j.value.changed : [];
    return { ...base, what: "changed", changed, detail: changed.length ? changed.join(", ") : "(nothing)", seq: j.ok && j.value ? j.value.seq : null };
  }
  if (kind === "events") {
    if (data.startsWith("css:")) return { ...base, what: "styles", detail: data.slice(data.indexOf(":", 4) + 1) };
    return { ...base, what: "reload", detail: `version ${data}` };
  }
  const j = parse(data);
  if (!j.ok || !Array.isArray(j.value)) return { ...base, what: "frame", detail: data.slice(0, 200) };
  const [k, channel, v] = j.value;
  if (k === "j" && e.kind === "ws-in") return { ...base, what: v ? "joined" : "refused", channel, detail: channel };
  if (k === "j") return { ...base, what: "join", channel, detail: channel };
  if (k === "l") return { ...base, what: "leave", channel, detail: channel };
  if (k === "v") return { ...base, what: "watch media", channel, detail: channel };
  if (k === "m") return { ...base, what: "message", channel, value: v, detail: channel };
  return { ...base, what: "frame", detail: data.slice(0, 200) };
}
