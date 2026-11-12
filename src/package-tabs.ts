import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PackageTab } from "./config.js";
import { isInside, pathProblem } from "./packages.js";

/** Largest tab data file the panel reads. */
export const MAX_TAB_DATA_BYTES = 1024 * 1024;
export const MAX_TAB_ITEMS = 500;
/** Largest file of the data folder the panel hands out for download. */
export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

/** What a package's tab may show: data only, never code, written by the package's own stations. */
export const TabDataSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        url: z.string().optional(),
        category: z.string().optional(),
        description: z.string().max(2000).optional(),
        date: z.string().optional(),
        /** A file of the package's data folder offered for download, relative to it. */
        file: z
          .string()
          .min(1)
          .max(500)
          .superRefine((path, ctx) => {
            const problem = pathProblem(path, "de datos del paquete");
            if (problem) ctx.addIssue({ code: "custom", message: problem });
          })
          .optional(),
      }),
    )
    .max(MAX_TAB_ITEMS),
});
export type TabItem = z.output<typeof TabDataSchema>["items"][number];

/** A tab's file as the panel may use it: absent, refused (no items), or valid items. */
export interface TabData {
  state: "missing" | "invalid" | "ok";
  items: TabItem[];
}

const missing: TabData = { state: "missing", items: [] };
const invalid: TabData = { state: "invalid", items: [] };

/** Reads a tab's JSON from the package's data folder; it never throws and never follows a link out of that folder. */
export function readTabData(dataDir: string, tab: Pick<PackageTab, "data">): TabData {
  let root: string;
  let real: string;
  try {
    root = realpathSync(dataDir);
  } catch {
    return missing;
  }
  try {
    real = realpathSync(join(root, tab.data));
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? missing : invalid;
  }
  if (!isInside(real, root)) return invalid;
  let raw: string;
  try {
    const fd = openSync(real, "r");
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_TAB_DATA_BYTES) return invalid;
      // Read at most one byte past the limit, in case the file grew after the stat.
      const buf = Buffer.alloc(Math.min(stat.size, MAX_TAB_DATA_BYTES) + 1);
      let read = 0;
      for (let n; read < buf.length && (n = readSync(fd, buf, read, buf.length - read, null)) > 0; ) read += n;
      if (read > MAX_TAB_DATA_BYTES) return invalid;
      raw = buf.subarray(0, read).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return invalid;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid;
  }
  const parsed = TabDataSchema.safeParse(json);
  return parsed.success ? { state: "ok", items: parsed.data.items } : invalid;
}

/** The real path of `file` inside the data folder when it is a regular file within MAX_DOWNLOAD_BYTES there, links resolved; it never throws. */
export function dataFile(dataDir: string, file: string): string | undefined {
  if (pathProblem(file)) return undefined;
  try {
    const root = realpathSync(dataDir);
    const real = realpathSync(join(root, file));
    if (!isInside(real, root) || real === root) return undefined;
    const stat = statSync(real);
    return stat.isFile() && stat.size <= MAX_DOWNLOAD_BYTES ? real : undefined;
  } catch {
    return undefined;
  }
}

/** The real path of a file the tab's current data lists with that exact `file`, under the same rules as `dataFile`; it never throws. */
export function tabFile(dataDir: string, tab: Pick<PackageTab, "data">, file: string): string | undefined {
  const data = readTabData(dataDir, tab);
  if (data.state !== "ok" || !data.items.some((i) => i.file === file)) return undefined;
  return dataFile(dataDir, file);
}

/** A name for a downloaded file: its base name with only safe characters. */
export function downloadName(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return clean || "descarga";
}

/** The url as a link target only when it is an absolute http or https URL. */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
