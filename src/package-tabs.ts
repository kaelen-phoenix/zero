import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PackageTab } from "./config.js";
import { isInside } from "./packages.js";

/** Largest tab data file the panel reads. */
export const MAX_TAB_DATA_BYTES = 1024 * 1024;
export const MAX_TAB_ITEMS = 500;

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
