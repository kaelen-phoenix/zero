import { closeSync, constants, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

/** The most entries an archive may hold. */
export const MAX_ENTRIES = 10_000;
/** The most bytes an archive may unpack to, declared or real. */
export const MAX_UNZIPPED_BYTES = 1024 ** 3;

export type UnzipResult = { ok: true; files: string[] } | { ok: false; reason: string };

export interface UnzipLimits {
  maxEntries?: number;
  maxBytes?: number;
}

interface Entry {
  name: string;
  dir: boolean;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

class Refused extends Error {}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = -1;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Why an entry's name may not be written, after turning backslashes into slashes. */
function nameProblem(name: string): string | undefined {
  if (!name || name.includes("\0")) return "tiene una entrada sin nombre válido";
  if (name.startsWith("/") || /^[a-z]:/i.test(name)) return `la entrada "${name}" tiene una ruta absoluta`;
  if (name.includes(":")) return `la entrada "${name}" tiene ":" en su nombre`;
  if (name.split("/").some((part) => part === "..")) return `la entrada "${name}" sale de la carpeta con ".."`;
  return undefined;
}

function findEnd(zip: Buffer): number {
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) if (zip.readUInt32LE(i) === EOCD) return i;
  throw new Refused("no es un zip: no tiene directorio central");
}

/** Every entry of the central directory, refused whole on anything this reader does not take. */
function readEntries(zip: Buffer, limits: Required<UnzipLimits>): Entry[] {
  const end = findEnd(zip);
  if (end >= 20 && zip.readUInt32LE(end - 20) === ZIP64_LOCATOR) throw new Refused("es un zip64, que no se acepta");
  const disk = zip.readUInt16LE(end + 4);
  const total = zip.readUInt16LE(end + 10);
  const size = zip.readUInt32LE(end + 12);
  const start = zip.readUInt32LE(end + 16);
  if (total === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Refused("es un zip64, que no se acepta");
  if (disk !== 0 || zip.readUInt16LE(end + 6) !== 0) throw new Refused("es un zip en varias partes, que no se acepta");
  if (total > limits.maxEntries) throw new Refused(`tiene más de ${limits.maxEntries} entradas`);
  if (start + size > end) throw new Refused("su directorio central está dañado");
  const entries: Entry[] = [];
  let declared = 0;
  let at = start;
  for (let i = 0; i < total; i++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL) throw new Refused("su directorio central está dañado");
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const external = zip.readUInt32LE(at + 38);
    const offset = zip.readUInt32LE(at + 42);
    if (at + 46 + nameLength + extraLength + commentLength > end) throw new Refused("su directorio central está dañado");
    const raw = zip.subarray(at + 46, at + 46 + nameLength);
    const name = raw.toString(flags & 0x800 ? "utf8" : "latin1").replaceAll("\\", "/");
    const extra = zip.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x41 || method === 99) throw new Refused(`la entrada "${name}" está cifrada`);
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff || hasZip64(extra)) throw new Refused("es un zip64, que no se acepta");
    if (((external >>> 16) & S_IFMT) === S_IFLNK) throw new Refused(`la entrada "${name}" es un enlace simbólico`);
    const problem = nameProblem(name);
    if (problem) throw new Refused(problem);
    const dir = name.endsWith("/");
    if (!dir && method !== 0 && method !== 8) throw new Refused(`la entrada "${name}" usa una compresión que no se acepta (${method})`);
    declared += size;
    if (declared > limits.maxBytes) throw new Refused(`descomprimido pasaría de ${limits.maxBytes} bytes`);
    entries.push({ name: name.replace(/\/+$/, ""), dir, method, crc, compressed, size, offset });
  }
  return entries.filter((e) => e.name !== "" && e.name !== ".");
}

function hasZip64(extra: Buffer): boolean {
  for (let i = 0; i + 4 <= extra.length; i += 4 + extra.readUInt16LE(i + 2)) if (extra.readUInt16LE(i) === 0x0001) return true;
  return false;
}

/** An entry's bytes, checked against its declared size and checksum. */
function contents(zip: Buffer, entry: Entry, left: number): Buffer {
  if (entry.offset + 30 > zip.length || zip.readUInt32LE(entry.offset) !== LOCAL) throw new Refused(`la entrada "${entry.name}" está dañada`);
  const from = entry.offset + 30 + zip.readUInt16LE(entry.offset + 26) + zip.readUInt16LE(entry.offset + 28);
  if (from + entry.compressed > zip.length) throw new Refused(`la entrada "${entry.name}" está dañada`);
  const data = zip.subarray(from, from + entry.compressed);
  let out: Buffer;
  if (entry.method === 0) out = data;
  else {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(entry.size, left)) });
    } catch {
      throw new Refused(`la entrada "${entry.name}" no se puede descomprimir o pasa del tamaño que declara`);
    }
  }
  if (out.length !== entry.size || out.length > left) throw new Refused(`la entrada "${entry.name}" no tiene el tamaño que declara`);
  if (crc32(out) !== entry.crc) throw new Refused(`la entrada "${entry.name}" está dañada`);
  return out;
}

/** The first symbolic link on the way from `root` to `path`, both included; nothing that does not exist yet. */
function linkOnTheWay(root: string, path: string): string | undefined {
  const parts = relative(root, path).split(sep).filter(Boolean);
  let at = root;
  for (const part of [undefined, ...parts]) {
    if (part) at = join(at, part);
    try {
      if (lstatSync(at).isSymbolicLink()) return at;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const NOFOLLOW = (constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

/**
 * Unpacks a zip under `dest`, which must not be or lie under a symbolic link below `root`. The whole archive is read and
 * checked before anything is written: encrypted entries, zip64, symbolic links, absolute paths, drives or `..`, too
 * many entries or too many bytes, declared or real, refuse it all. Never throws.
 */
export async function unzip(zipPath: string, dest: string, root: string = dest, limits: UnzipLimits = {}): Promise<UnzipResult> {
  const max = { maxEntries: limits.maxEntries ?? MAX_ENTRIES, maxBytes: limits.maxBytes ?? MAX_UNZIPPED_BYTES };
  try {
    const target = resolve(dest);
    const base = resolve(root);
    const rel = relative(base, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Refused("el destino sale de su carpeta");
    const zip = await readFile(zipPath);
    const entries = readEntries(zip, max);
    // First pass: every entry's bytes and every place it goes, before writing anything.
    let left = max.maxBytes;
    for (const entry of entries) {
      if (!entry.dir) left -= contents(zip, entry, left).length;
      const link = linkOnTheWay(base, join(target, ...entry.name.split("/")));
      if (link) throw new Refused(`el destino tiene un enlace simbólico: ${relative(base, link) || "."}`);
    }
    if (linkOnTheWay(base, target)) throw new Refused("el destino es o está bajo un enlace simbólico");
    const files: string[] = [];
    mkdirSync(target, { recursive: true });
    left = max.maxBytes;
    for (const entry of entries) {
      const path = join(target, ...entry.name.split("/"));
      if (linkOnTheWay(base, path)) throw new Refused(`el destino tiene un enlace simbólico: ${relative(base, path)}`);
      if (entry.dir) {
        mkdirSync(path, { recursive: true });
        continue;
      }
      const data = contents(zip, entry, left);
      left -= data.length;
      mkdirSync(dirname(path), { recursive: true });
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW, 0o644);
      try {
        for (let done = 0; done < data.length; ) done += writeSync(fd, data, done);
      } finally {
        closeSync(fd);
      }
      files.push(entry.name);
    }
    return { ok: true, files };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: `no se descomprime: ${err.message}` };
    return { ok: false, reason: `no se pudo descomprimir: ${err instanceof Error ? err.message : String(err)}` };
  }
}
