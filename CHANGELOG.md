# Changelog

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
