// The devtools page: adds the Quillo panel, and a "Quillo" pane beside the Elements
// panel's styles, for the component the selected element is in.

import { selected } from "./lib/page.js";

chrome.devtools.panels.create("Quillo", "icons/quillo-32.png", "panel.html", (panel) => {
  // The panel reads the page only while it is shown.
  let win = null;
  panel.onShown.addListener((w) => { win = w; w.dispatchEvent(new Event("quillo-shown")); });
  panel.onHidden.addListener(() => { if (win) win.dispatchEvent(new Event("quillo-hidden")); });
});

chrome.devtools.panels.elements.createSidebarPane("Quillo", (pane) => {
  const show = () => pane.setExpression(`(${selected.toString()})($0)`, "Quillo component");
  chrome.devtools.panels.elements.onSelectionChanged.addListener(show);
  show();
});
