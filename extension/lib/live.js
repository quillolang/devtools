// What Quillo's WebSockets carry, as main.js hears it, made readable.
//
//   /_quillo/live    live data: `?since=<seq>&s=<server>&t=<topics>` names what the page
//                    follows; each message is { seq, server, changed: [topics] }, and the
//                    `live(...)` states that read a changed topic load again (as calls
//                    with x-quillo-live, in the Calls tab)
//   /_quillo/wt      channels, when WebTransport is not used: ["j", name] joins,
//                    ["l", name] leaves, ["m", name, value] a message; the server's
//                    ["j", name, true|false] lets the page in or not; binary frames are media
//   /_quillo/events  --watch: the program's version; at a new one the page asks for itself
//                    again and is kept as it is, or reloaded (what it decided comes as a
//                    "quillo:hmr" event: `hmr` below); "css:<n>:<paths>" swaps stylesheets in
//                    place; "err:<n>:<json>" is a save that did not load (null once one does)

import { parse } from "./values.js";

const params = (query) => {
  const p = new URLSearchParams(query || "");
  return { since: p.get("since"), server: p.get("s"), topics: (p.get("t") || "").split(",").filter(Boolean) };
};

// What --watch's page script decided after a save, as a line.
const WHY = {
  html: "its HTML changed",
  code: "its code changed",
  off: "it asks to be reloaded (--watch=reload, data-reload or QW.hot = false)",
  failed: "the check could not be made",
};
function hmr(e) {
  const base = { at: e.at, socket: "", path: "/_quillo/events", dir: "" };
  if (e.what === "kept") return { ...base, what: "kept", detail: `version ${e.version}: nothing the page uses changed, so it was not reloaded` };
  return { ...base, what: "reloads", detail: `version ${e.version}: ${WHY[e.why] || e.why || "a change"}` };
}

// One event of main.js's ("ws-open", "ws-in", "ws-out", "ws-close", "hmr") as a line:
// { at, socket, dir, what, detail, topics?, changed?, channel?, failed? }.
export function describe(e) {
  if (e.kind === "hmr") return hmr(e);
  const base = { at: e.at, socket: e.id, path: e.path, dir: e.kind === "ws-in" ? "in" : e.kind === "ws-out" ? "out" : "" };
  const kind = (e.path || "").replace(/^\/_quillo\//, "");
  if (e.kind === "ws-open") {
    if (kind === "live") {
      const p = params(e.query);
      return { ...base, what: "follows", topics: p.topics, detail: `${p.topics.length} topic${p.topics.length === 1 ? "" : "s"}, from change ${p.since || 0}` };
    }
    if (kind === "events") return { ...base, what: "watching", detail: "--watch: told of each save" };
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
    if (data.startsWith("err:")) {
      const j = parse(data.slice(data.indexOf(":", 4) + 1));
      const said = j.ok && typeof j.value === "string" ? j.value : null;
      if (said === null) return { ...base, what: "save loads", detail: "a save loaded after the one that failed" };
      return { ...base, what: "save failed", detail: said.split("\n")[0], failed: said };
    }
    return { ...base, what: "new version", detail: `version ${data}` };
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
