import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

// node:sqlite is required at runtime, as in test/state.test.ts.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** The removed proof of concept left its rows behind: they stay, and no code reaches them. */
describe("data of the removed proof of concept", () => {
  const tables = (path: string) => {
    const db = new DatabaseSync(path);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'social_posts%' ORDER BY name").all().map((r) => String((r as { name: unknown }).name));
    db.close();
    return names;
  };

  it("leaves an existing social_posts table and its rows as they are", () => {
    const path = join(tempDir(), "state.db");
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TABLE social_posts (id TEXT PRIMARY KEY, topic TEXT NOT NULL); INSERT INTO social_posts VALUES ('a', 'uno'), ('b', 'dos');");
    raw.close();
    new Store(path).close();
    const after = new DatabaseSync(path);
    expect(after.prepare("SELECT id, topic FROM social_posts ORDER BY id").all().map((r) => ({ ...r }))).toEqual([{ id: "a", topic: "uno" }, { id: "b", topic: "dos" }]);
    after.close();
  });

  it("creates no such table in a new state.db", () => {
    const path = join(tempDir(), "state.db");
    new Store(path).close();
    expect(tables(path)).toEqual([]);
  });

  it("has no code that names the table", () => {
    const root = new URL("../src/", import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(files.filter((f) => readFileSync(new URL(f.replace(/\\/g, "/"), root), "utf8").includes("social_posts"))).toEqual([]);
  });
});
