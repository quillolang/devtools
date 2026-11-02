# Quillo DevTools

A **Quillo** panel in the browser's developer tools, for pages made by
[Quillo](https://quillolang.org): the components on the page with their props and state,
the server fn calls the page makes, live updates, the errors Quillo catches, and the
server's health and query times.

Test coverage: **100.00% of lines** (1,201 of 1,201 in `extension/`), by 32 unit tests
in Node and 24 tests in Chrome on a Quillo app. See [Tests](#tests).

| Tab | What it shows |
|---|---|
| **Components** | Every component on the page, nested as on the page, with its props and state. Hover one to see it on the page; *Show in Elements* selects it there. With **Current state** on, props and state are as they are now, and ✎ sets a state. Each prop says where it comes from (`← <Parent>.a`, `← <Parent>'s prop title ← <Grand>.g`, fixed in the markup, written by the server, a loop's item, its default), each component named a link to it; and the component's states and lets are listed with their kind (state, live state, let, let worked out again, function), their value and what each reads |
| **Calls** | Each server fn call: its arguments, its answer or error value, its time and status; a live state loading again, a call sent once (`idempotent`) and resent, files sent with it |
| **Live** | What the page's live states follow (tables and globals), each change the server announces, and channel messages when they go over a WebSocket; under `--watch`, reloads |
| **Errors** | The errors Quillo catches in the page, and how many components were taken up as the server sent them or made again |
| **Server** | `/_quillo/health`, `/_quillo/ready`, the database's statements and their times (`/_quillo/health/queries`, on under `--watch`), and the routes and server fns (`--describe`) |

The Elements panel gets a **Quillo** pane too: the component the selected element is in.

## Install

For Chrome and Edge, 111 or later. Until it is in their stores:

1. Download this repository (or `npm run package` and unzip `dist/quillo-devtools-<version>.zip`).
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**.
3. **Load unpacked**, and pick the `extension/` folder.
4. Open the developer tools on a Quillo page: the **Quillo** tab is beside the others.
   Reload a page that was already open, so that the extension hears it from the start.

Firefox is not supported yet: it has no `chrome.debugger`, which **Current state** needs
(see below). The rest has not been tried there.

## How it reads the page

Quillo's browser runtime keeps everything in a closure and has no interface for tools
(FEEDBACK42.md in [quillolang/quillo](https://github.com/quillolang/quillo), under
`feedback/reports/`, sets out what one could be). So the extension reads what the page
shows from outside:

- **Components** come from the islands on the page (`<quillo-island data-c data-p data-s>`).
  `data-s` is the state the server rendered the component with, and Quillo never writes
  it again: once a component runs, its state may differ. The panel says which it shows.
  A component inside another is written with no props (its outer one passes them), and
  one made in the browser has neither.
- **Current state** reads each component's state as it is now through the browser's
  debugger (`chrome.debugger`): it finds the runtime's own objects through the closure
  of a function the runtime puts on the page. The browser shows a bar while it is on.
  This depends on names inside Quillo's runtime that it does not promise to keep; when
  they change, the panel says so rather than showing something wrong. Tested on Quillo
  0.6.0 and on its main branch (54dd1bd).
- **Where props come from, and the lets** are read from the code Quillo compiled for each
  component (the same in production and under `--watch`): a child's prop is a getter
  whose text names what it reads in its parent (`$a_2` is the parent's `a`, `$p.title`
  its prop `title`), followed up to the state or let it ends at. A let's value is the
  browser's where it keeps it (in a closure); one it did not keep (used once, when the
  component was made) is shown as written. Something made inside the parent's markup by
  a view or a block has no name left in the compiled code, and is said so.
- **A component nothing can change** (no handler, live state or timer) is let go by the
  browser once it is on the page: with **Current state** on, the panel says so, and
  shows what the server rendered, which is what the page keeps showing.
- **Calls** come from the Network panel's own record, so only those made while the
  developer tools are open.
- **Errors and live updates** come from two content scripts. `page/main.js` runs in the
  page before its scripts. On a Quillo page it makes `window.__quilloErrors`, the list
  Quillo pushes its errors onto when a page has made one. On every page it watches
  WebSockets opened to `/_quillo/live`, `/_quillo/wt` and `/_quillo/events`, and leaves
  every other socket alone. `page/bridge.js` keeps what it hears for the panel, in the
  extension's own world. Channels over WebTransport, which Chrome uses when the server
  offers it, cannot be heard by anything (run with `--no-wt` to see them).

Nothing leaves the browser. The extension asks for every site (`<all_urls>`) because a
Quillo program can be served from any address. It asks for `debugger` only for
**Current state**, which attaches when turned on and lets go when turned off.

A page's own script could send the content scripts made-up events: the extension is a
tool for the developer of the page, not a record to trust.

## Tests

```sh
npm test                                  # unit tests, in Node
QUILLO_BIN=/path/to/quillo npm run test:browser
QUILLO_BIN=/path/to/quillo npm run coverage
```

`test:browser` runs [tests/fixtures/app](tests/fixtures/app) on the Quillo you name, in
production and under `--watch`, loads the extension into headless Chrome (through the
protocol's `Extensions.loadUnpacked`, as Chrome 137 and later take no `--load-extension`),
and checks the content scripts, the page functions and the state reader on it. Then it
opens the panel as a page of the extension's, with `chrome.devtools` stood in for, and the
real `chrome.debugger`, and checks each tab. A screenshot of each goes in `tests/out/`.
`CHROME` names the browser, and `CHROME_FLAGS` adds flags (CI uses `--no-sandbox`).

`coverage` runs both with V8's coverage on, in Node and in Chrome, and counts the lines of
`extension/` that ran, from [scripts/coverage.mjs](scripts/coverage.mjs). The figure above
is from a build of Quillo's main branch (54dd1bd). On the 0.6.0 release the query-time
table is not drawn (0.6.0 has no `/_quillo/health/queries`), so a few lines of the panel
are not run there.

CI ([.github/workflows/check.yml](.github/workflows/check.yml)) runs both suites on each
Quillo release the extension supports, and keeps the screenshots and the packaged zip.

## Releasing

Bump the version in `extension/manifest.json` and `package.json`, add its section to
[CHANGELOG.md](CHANGELOG.md), and push a tag `v<version>`.
[release.yml](.github/workflows/release.yml) runs the tests, then publishes the zip to the
Chrome Web Store and Edge Add-ons, and to a GitHub release with that section's notes. Each
store is skipped until its secrets are set (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
`CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID`; `EDGE_CLIENT_ID`, `EDGE_API_KEY`,
`EDGE_PRODUCT_ID`), which they can be once the first upload to that store was made by hand.

## Layout

```
extension/
  manifest.json        Manifest V3
  devtools.html/.js    adds the panel and the Elements pane
  panel.html/.css/.js  the panel
  lib/page.js          functions the panel runs in the page: the islands, a box over one
  lib/state.js         current state through the debugger protocol
  lib/mapping.js       where props come from, and the states and lets, from compiled code
  lib/calls.js         a server fn call from the Network panel's record
  lib/live.js          what Quillo's sockets carry, made readable
  lib/values.js        Quillo's values on the wire ($dec, $int, $quillo_err) and as text
  lib/debugger.js      chrome.debugger for one tab
  page/main.js         content script, the page's world: errors, Quillo's sockets
  page/bridge.js       content script, the extension's world: keeps what main.js hears
tests/unit/            Node's test runner
tests/browser/         Chrome over the protocol, the fixture app on Quillo
tests/fixtures/app/    a Quillo app with one of each thing the panel shows
scripts/               package.mjs (the zip), coverage.mjs
```

No dependencies: Node 22 or later, and Chrome.

## License

MIT
