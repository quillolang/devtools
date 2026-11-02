// Runs in the page's own world, before the page's scripts (run_at document_start).
// Quillo's runtime keeps everything in a closure, so this hears what it can from
// outside it, and passes it to bridge.js as a "quillo-devtools" event on the document,
// its detail a JSON string (the one kind of value that crosses between worlds):
//
// - the errors Quillo catches, through the hook it documents: Quillo pushes each
//   onto `window.__quilloErrors` "if the page made that list", so on a Quillo page
//   this makes it, as a list whose push also says so;
// - what Quillo's own WebSockets carry (/_quillo/live, /_quillo/wt, /_quillo/events),
//   by a WebSocket that is the browser's, watched. Any other socket is left alone.
//
// Nothing else is put on the page: no global of this extension's own.
(() => {
  const say = (kind, data) => {
    try {
      document.dispatchEvent(new CustomEvent("quillo-devtools", { detail: JSON.stringify({ kind, at: Date.now(), ...data }) }));
    } catch (_) {}
  };

  // Quillo's sockets: one of the page's, its path under /_quillo/ (or a mount's
  // /<prefix>/_quillo/).
  const OWN = /\/_quillo\/(live|wt|events)(\?|$)/;
  const Native = window.WebSocket;
  let sockets = 0;
  if (typeof Native === "function") {
    window.WebSocket = new Proxy(Native, {
      construct(target, args, newTarget) {
        const ws = Reflect.construct(target, args, newTarget === window.WebSocket ? target : newTarget);
        let url;
        try { url = new URL(String(args[0]), location.href); } catch (_) { return ws; }
        if (!OWN.test(url.pathname + "?")) return ws;
        const id = ++sockets;
        const path = url.pathname.replace(/.*(\/_quillo\/)/, "$1");
        say("ws-open", { id, path, query: url.search });
        const text = (d) => (typeof d === "string" ? d.slice(0, 20000) : `(${d && d.byteLength || 0} bytes)`);
        ws.addEventListener("message", (m) => say("ws-in", { id, path, data: text(m.data) }));
        ws.addEventListener("close", (e) => say("ws-close", { id, path, code: e.code }));
        const send = ws.send;
        ws.send = function (d) {
          say("ws-out", { id, path, data: text(d) });
          return send.call(this, d);
        };
        return ws;
      },
    });
  }

  // The error list, only on a page of Quillo's: made when the document is parsed,
  // which is before Quillo's bundle comes (its loader waits for the same moment, and
  // this listener was added first).
  const quillo = () => !!document.querySelector("quillo-island,[data-qi],script[src*='/_quillo/']");
  document.addEventListener("DOMContentLoaded", () => {
    if (!quillo()) return;
    say("page", { url: location.href });
    if (Object.prototype.hasOwnProperty.call(window, "__quilloErrors")) return;
    const list = [];
    Object.defineProperty(list, "push", {
      value(...xs) {
        for (const x of xs) say("error", { message: String(x) });
        return Array.prototype.push.apply(this, xs);
      },
    });
    window.__quilloErrors = list;
  }, { once: true });
})();
