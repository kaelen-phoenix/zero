import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzip } from "../src/unzip.js";
import { cleanup, tempDir } from "./helpers.js";
import { makeZip, type ZipEntry } from "./zip.js";

afterEach(() => cleanup());

function zipFile(entries: ZipEntry[]): { root: string; zip: string } {
  const root = tempDir("zero-unzip-");
  const zip = join(root, "in.zip");
  writeFileSync(zip, makeZip(entries));
  return { root, zip };
}

/** Everything under a folder but the zip itself. */
const written = (root: string) => readdirSync(root, { recursive: true }).map(String).filter((f) => f !== "in.zip");

describe("unzip", () => {
  it("unpacks a normal zip, deflated and stored", async () => {
    const { root, zip } = zipFile([{ name: "src/a.txt", data: "hola" }, { name: "README.md", data: "# léeme", method: 0 }, { name: "vacia/" }]);
    const r = await unzip(zip, join(root, "work"), root);
    expect(r).toEqual({ ok: true, files: ["src/a.txt", "README.md"] });
    expect(readFileSync(join(root, "work", "src", "a.txt"), "utf8")).toBe("hola");
    expect(readFileSync(join(root, "work", "README.md"), "utf8")).toBe("# léeme");
    expect(existsSync(join(root, "work", "vacia"))).toBe(true);
  });

  it.each(["../../x.txt", "a/../../x.txt", "..\\x.txt", "/etc/x.txt", "C:/x.txt", "c:x.txt", "a:b.txt"])("refuses the whole archive for %s", async (name) => {
    const { root, zip } = zipFile([{ name: "ok.txt", data: "ok" }, { name, data: "x" }]);
    const r = await unzip(zip, join(root, "work"), root);
    expect(r).toMatchObject({ ok: false, reason: expect.any(String) });
    expect(written(root)).toEqual([]);
  });

  it("refuses a symbolic link entry", async () => {
    const { root, zip } = zipFile([{ name: "ok.txt", data: "ok" }, { name: "link", data: "/etc/passwd", mode: 0o120777 }]);
    const r = await unzip(zip, join(root, "work"), root);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("enlace") });
    expect(written(root)).toEqual([]);
  });

  it("refuses an encrypted entry", async () => {
    const { root, zip } = zipFile([{ name: "a.txt", data: "x", flags: 1 }]);
    expect(await unzip(zip, join(root, "work"), root)).toMatchObject({ ok: false, reason: expect.stringContaining("cifrada") });
    expect(written(root)).toEqual([]);
  });

  it("refuses too many entries", async () => {
    const { root, zip } = zipFile(Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })));
    expect(await unzip(zip, join(root, "work"), root, { maxEntries: 5 })).toMatchObject({ ok: false, reason: expect.stringContaining("entradas") });
    expect(written(root)).toEqual([]);
  });

  it("refuses a size bomb by its declared size", async () => {
    const { root, zip } = zipFile([{ name: "ok.txt", data: "ok" }, { name: "bomb.bin", data: Buffer.alloc(2 * 1024 * 1024) }]);
    expect(await unzip(zip, join(root, "work"), root, { maxBytes: 1024 * 1024 })).toMatchObject({ ok: false, reason: expect.stringContaining("bytes") });
    expect(written(root)).toEqual([]);
  });

  it("refuses an entry that unpacks to more than it declares", async () => {
    const { root, zip } = zipFile([{ name: "ok.txt", data: "ok" }, { name: "liar.bin", data: Buffer.alloc(2 * 1024 * 1024), size: 10 }]);
    expect(await unzip(zip, join(root, "work"), root)).toMatchObject({ ok: false, reason: expect.stringContaining("liar.bin") });
    expect(written(root)).toEqual([]);
  });

  it("refuses a destination outside its root", async () => {
    const { root, zip } = zipFile([{ name: "a.txt", data: "x" }]);
    const outside = tempDir("zero-outside-");
    expect(await unzip(zip, join(root, "..", "elsewhere"), root)).toMatchObject({ ok: false, reason: expect.stringContaining("destino") });
    expect(await unzip(zip, outside, root)).toMatchObject({ ok: false });
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses a destination under a symbolic link", async () => {
    const { root, zip } = zipFile([{ name: "a.txt", data: "x" }]);
    const outside = tempDir("zero-outside-");
    symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    expect(await unzip(zip, join(root, "link", "work"), root)).toMatchObject({ ok: false, reason: expect.stringContaining("enlace") });
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses an entry that would go through a link already in the destination", async () => {
    const { root, zip } = zipFile([{ name: "sub/a.txt", data: "x" }]);
    const outside = tempDir("zero-outside-");
    mkdirSync(join(root, "work"));
    symlinkSync(outside, join(root, "work", "sub"), process.platform === "win32" ? "junction" : "dir");
    expect(await unzip(zip, join(root, "work"), root)).toMatchObject({ ok: false, reason: expect.stringContaining("enlace") });
    expect(readdirSync(outside)).toEqual([]);
  });

  it("answers a file that is not a zip without throwing", async () => {
    const root = tempDir("zero-unzip-");
    writeFileSync(join(root, "in.zip"), "no soy un zip");
    expect(await unzip(join(root, "in.zip"), join(root, "work"), root)).toMatchObject({ ok: false });
  });
});
