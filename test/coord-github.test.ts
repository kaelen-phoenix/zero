import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { githubCoord } from "../src/coord/github.js";
import { claimJob, CoordConflict, heartbeat, listMachines, releaseJob, stillHolds } from "../src/coord/protocol.js";

/** A real Octokit over a fake fetch that keeps git refs and commits like GitHub's git data API. */
function fakeGithub() {
  const paths: string[] = [];
  const refs = new Map<string, string>();
  const commits = new Map<string, { message: string; parents: string[] }>();
  let n = 0;
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const descends = (sha: string, from: string): boolean => sha === from || (commits.get(sha)?.parents ?? []).some((p) => descends(p, from));
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = decodeURIComponent(url.pathname);
    paths.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const base = "/repos/me/zero-coord/git";
    if (method === "POST" && path === `${base}/trees`) return json(201, { sha: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" });
    if (method === "POST" && path === `${base}/commits`) {
      const sha = (++n).toString(16).padStart(40, "0");
      commits.set(sha, { message: body.message, parents: body.parents });
      return json(201, { sha });
    }
    if (method === "GET" && path.startsWith(`${base}/commits/`)) {
      const c = commits.get(path.slice(`${base}/commits/`.length));
      return c ? json(200, { message: c.message }) : json(404, { message: "Not Found" });
    }
    if (method === "POST" && path === `${base}/refs`) {
      if (refs.has(body.ref)) return json(422, { message: "Reference already exists" });
      refs.set(body.ref, body.sha);
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (method === "GET" && path.startsWith(`${base}/matching-refs/`)) {
      const prefix = `refs/${path.slice(`${base}/matching-refs/`.length)}`;
      return json(200, [...refs].filter(([r]) => r.startsWith(prefix)).map(([ref, sha]) => ({ ref, object: { sha } })));
    }
    if (path.startsWith(`${base}/ref/`) || path.startsWith(`${base}/refs/`)) {
      const ref = `refs/${path.replace(/^.*?\/git\/refs?\//, "")}`;
      const tip = refs.get(ref);
      if (method === "GET") return tip ? json(200, { ref, object: { sha: tip } }) : json(404, { message: "Not Found" });
      if (method === "PATCH") {
        if (!tip) return json(422, { message: "Reference does not exist" });
        if (!body.force && !descends(body.sha, tip)) return json(422, { message: "Update is not a fast forward" });
        refs.set(ref, body.sha);
        return json(200, { ref, object: { sha: body.sha } });
      }
      if (method === "DELETE") {
        if (!tip) return json(422, { message: "Reference does not exist" });
        refs.delete(ref);
        return new Response(null, { status: 204 });
      }
    }
    return json(404, { message: `unexpected ${method} ${path}` });
  };
  const octokit = new Octokit({ request: { fetch } });
  return { octokit, paths, refs };
}

const A = { id: "id-a", name: "pc-vieja" };
const B = { id: "id-b", name: "notebook" };
const caps = { platform: "linux" as const, box: true, engines: ["claude"] };
const t0 = new Date("2026-11-15T12:00:00Z");

describe("githubCoord", () => {
  it("maps an existing ref to CoordConflict", async () => {
    const octokit = {
      git: {
        createTree: async () => ({ data: { sha: "tree" } }),
        createCommit: async () => ({ data: { sha: "c1" } }),
        createRef: async () => {
          throw Object.assign(new Error("Reference already exists"), { status: 422 });
        },
      },
    } as unknown as Octokit;
    await expect(githubCoord(octokit, "me/zero-coord").create("claims/job1", "{}")).rejects.toBeInstanceOf(CoordConflict);
  });

  it("maps a move that is not a fast-forward to CoordConflict", async () => {
    const { octokit } = fakeGithub();
    const api = githubCoord(octokit, "me/zero-coord");
    const first = await api.create("claims/job1", "1");
    await api.update("claims/job1", "2", first);
    await expect(api.update("claims/job1", "3", first)).rejects.toBeInstanceOf(CoordConflict);
    expect((await api.read("claims/job1"))?.data).toBe("2");
  });

  it("keeps records under refs/heads/zero-coord/ and never calls Actions", async () => {
    const { octokit, paths, refs } = fakeGithub();
    const api = githubCoord(octokit, "me/zero-coord");
    expect(await claimJob(api, "job1", A, t0)).toEqual({ claimed: true });
    expect(await claimJob(api, "job1", B, t0)).toEqual({ claimed: false, holder: expect.objectContaining({ machine: A.id }) });
    await heartbeat(api, A, caps, ["job1"], t0);
    await heartbeat(api, A, caps, ["job1"], new Date(t0.getTime() + 60_000));
    await heartbeat(api, B, caps, [], t0);
    expect((await listMachines(api, new Date(t0.getTime() + 60_000))).map((m) => [m.name, m.alive])).toEqual([
      ["notebook", true],
      ["pc-vieja", true],
    ]);
    const later = new Date(t0.getTime() + 20 * 60_000);
    expect(await claimJob(api, "job1", B, later, 10)).toEqual({ claimed: true });
    expect(await stillHolds(api, "job1", A.id)).toBe(false);
    expect(await releaseJob(api, "job1", A.id)).toBe(false);
    expect(await releaseJob(api, "job1", B.id)).toBe(true);
    expect([...refs.keys()].sort()).toEqual(["refs/heads/zero-coord/machines/id-a", "refs/heads/zero-coord/machines/id-b"]);
    expect(await api.read("claims/job1")).toBeUndefined();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.includes("/actions/"))).toBe(false);
  });

  it("refuses a repository not shaped owner/name", () => {
    expect(() => githubCoord(fakeGithub().octokit, "zero-coord")).toThrow();
  });
});
