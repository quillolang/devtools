// The fixture app (tests/fixtures/app) on a Quillo of your choice, in a folder of its
// own, on a free port. QUILLO_BIN names the binary; otherwise `quillo` on the PATH.
//
//   const app = await start({ watch: true, describe: true, args: ["--no-wt"] })
//   app.url        http://127.0.0.1:<port>
//   app.stop()

import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "app");

export const quilloBin = () => process.env.QUILLO_BIN || "quillo";

export function quilloVersion() {
  try { return execFileSync(quilloBin(), ["--version"], { encoding: "utf8" }).trim(); } catch (_) { return null; }
}

const freePort = () => new Promise((ok, no) => {
  const s = createServer();
  s.on("error", no);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});

export async function start({ watch = false, describe = false, args: extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "quillo-devtools-app-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const port = await freePort();
  const args = ["run", "main.qwe", "--port", String(port), ...(watch ? ["--watch"] : []), ...(describe ? ["--describe"] : []), ...extra];
  const proc = spawn(quilloBin(), args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let t = 0; ; t += 100) {
    try { if ((await fetch(url + "/_quillo/health")).ok) break; } catch (_) {}
    if (proc.exitCode !== null || t > 15000) throw new Error(`quillo did not start:\n${log}`);
    await sleep(100);
  }
  return {
    url,
    get log() { return log; },
    stop() {
      proc.kill();
      try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}
