// Runs in the extension's own world on the page (a content script's), where the page
// cannot reach. It keeps what main.js says, numbered, for the panel, which asks with
// chrome.devtools.inspectedWindow.eval(..., { useContentScriptContext: true }):
//
//   __quilloDevtools.since(n)   { doc, last, dropped, events: [...] } after event n
//
// `doc` is this document's own id: a new one after a navigation or a reload, so the
// panel knows to start again. At most 2,000 events are kept; `dropped` counts the rest.
(() => {
  const MAX = 2000;
  const doc = Math.random().toString(36).slice(2, 10);
  const events = [];
  let last = 0, dropped = 0;
  document.addEventListener("quillo-devtools", (e) => {
    if (typeof e.detail !== "string") return;
    let m;
    try { m = JSON.parse(e.detail); } catch (_) { return; }
    if (!m || typeof m.kind !== "string") return;
    m.n = ++last;
    events.push(m);
    if (events.length > MAX) { events.shift(); dropped++; }
  });
  globalThis.__quilloDevtools = {
    since(n) {
      return { doc, last, dropped, events: events.filter((e) => e.n > n) };
    },
  };
})();
