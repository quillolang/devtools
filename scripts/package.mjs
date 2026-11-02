// The extension as a zip for the Chrome Web Store and Edge Add-ons:
// dist/quillo-devtools-<version>.zip, with extension/'s files at its root.
//
//   node scripts/package.mjs

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "extension");
const { version } = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.startsWith(".") ? [] : [join(d, e.name)]));
const files = walk(ext).sort();

// A zip of the plainest kind: each file deflated, a central directory, the end record.
const parts = [], central = [];
let offset = 0;
const when = (t) => ({ time: (t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1), date: ((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate() });
for (const f of files) {
  const name = Buffer.from(relative(ext, f).split("\\").join("/"));
  const data = readFileSync(f);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const { time, date } = when(statSync(f).mtime);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  parts.push(local, name, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += 30 + name.length + packed.length;
}
const dir = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", `quillo-devtools-${version}.zip`);
writeFileSync(out, Buffer.concat([...parts, dir, end]));
console.log(`${relative(root, out)}: ${files.length} files`);
