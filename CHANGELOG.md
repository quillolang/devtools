# Changelog


## 0.3.0 (unreleased)

- Quillo's HMR (Quillo FEEDBACK54.md, on its `hmr` branch): the Live tab says what each save did
  to the page, from the `quillo:hmr` event the page now sends: **kept** (nothing it uses changed)
  or **swapped** (its changed components swapped in place, their states kept), or **reloads**, and why (its HTML or its code changed, it asks to be reloaded, or the check
  could not be made). A new version is "new version", no longer "reload".
- A save that does not load (`err:` on `/_quillo/events`) is "save failed" in the Live tab, with
  the first line of what it said, and in the Errors tab whole; "save loads" when one loads after.
- Tests: the unit tests read the new messages; a browser test, with an app of its own under
  `--watch`, saves a route the page does not use (kept), a broken file (failed) and the fix
  (loads again, the overlay gone), skipped on a Quillo before HMR. 25 browser and 36 unit tests
  pass on the HMR build (24 and 36 on 0.8.4); coverage 100% (1,304 lines).

## 0.2.2

- **Quillo 0.8.3's plain pages.** Since Quillo 0.8.3 a page with no link, script or component
  is sent as its route made it, without the prefetch script that had marked every page as
  Quillo's, so the panel said "No Quillo on this page" on such a page. When the page has
  nothing of Quillo's, the panel now asks its server's `/_quillo/health`, once for each origin,
  and takes the page for Quillo's when it answers as only Quillo does (`ok` or `unavailable`);
  a server that answers otherwise, or not at all, is not taken for Quillo.
- Tested on Quillo 0.8.3, 0.8.2 and 0.8.1: 35 unit tests and 24 in Chrome; every line of
  `extension/` runs (1,280). CI tests v0.8.3 too, and the release workflow tests on it.

## 0.2.1

- **Where props come from, on Quillo 0.8.** Since Quillo 0.8.0 a component keeps its own
  getter for each prop its parent passes (one that remembers what it last read once the
  component has left the page, Quillo's Q-762), so the panel read nothing after "←" for a
  prop from a state, a let or the parent's prop. It now finds the parent's getter in that
  getter's closure, through the debugger, and maps it as before; pages from older Quillo
  read as they did.
- **The health token.** Since Quillo 0.8 `/_quillo/ready` lists each check only to a
  request with the server's `QUILLO_HEALTH_TOKEN` (Quillo's Q-655), so the Server tab's
  "What it needs" was empty. The tab has a field for it now: typed, it is sent as
  `Authorization: Bearer` to that page's server only, to `/_quillo/ready` and
  `/_quillo/health/queries` (each statement's figures outside `--watch`), and kept in the
  panel until it closes, never stored. Without it the tab says the checks need it; a
  token the server does not take is said so.
- Tested on Quillo 0.8.2 and 0.8.1 (89a91c2), in production and under
  `--watch`: 35 unit tests and 24 in Chrome; every line of `extension/` runs (1,264).
- The release workflow tests on Quillo 0.8.2 (was 0.6.0).

## 0.2.0

- **Where props come from.** With Current state on, each prop of the picked component
  says what it reads in its parent: a state (`← <Parent>.a`), a let worked out again,
  the parent's own prop followed up to where it starts (`← <Parent>'s prop title ←
  <Grand>.g`), a fixed value, the server's page, its default, a loop's item, or a value
  made inside the parent's markup by a view. Each component named is a link to it.
- **States and lets.** The picked component's states, live states and lets, each with
  its kind, its value, and, for a let worked out again, what it reads. A let the browser
  did not keep is shown as written.
- A component nothing in the browser can change (no handler, live state or timer) is
  let go by the browser once it is on the page: the panel says so.
- The Errors tab's badge no longer shows "0".
- Read from the code Quillo compiles (`lib/mapping.js`); tested on Quillo 0.6.0 and on
  main (54dd1bd), in production and under `--watch`. 56 tests, every line covered.

## 0.1.0

- The Quillo panel: Components (props and state, as the server rendered them, or as they
  are now with Current state, which sets a state too), Calls (server fn calls), Live
  (what live states follow, changes, channels over a WebSocket, `--watch` reloads),
  Errors, and Server (health, ready, query times, `--describe`).
- A Quillo pane beside the Elements panel.
- Tested in Chrome on Quillo 0.6.0 and main (487c518), in production and under `--watch`.
