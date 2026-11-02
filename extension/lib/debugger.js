// chrome.debugger for one tab, as `send(method, params)` for state.js. Attaching shows
// the browser's own bar ("Quillo DevTools started debugging this browser"); closing
// that bar detaches, and `onDetach` says so.

export function debuggerFor(tabId, onDetach) {
  const target = { tabId };
  let attached = false;
  const p = (f) => new Promise((res, rej) => f((r) => {
    const e = chrome.runtime.lastError;
    if (e) rej(new Error(e.message)); else res(r);
  }));
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId !== tabId || !attached) return;
    attached = false;
    if (onDetach) onDetach(reason);
  });
  return {
    get attached() { return attached; },
    async attach() {
      if (attached) return;
      await p((cb) => chrome.debugger.attach(target, "1.3", cb));
      attached = true;
    },
    async detach() {
      if (!attached) return;
      attached = false;
      await p((cb) => chrome.debugger.detach(target, cb)).catch(() => {});
    },
    send: (method, params = {}) => p((cb) => chrome.debugger.sendCommand(target, method, params, cb)),
  };
}
