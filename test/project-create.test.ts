import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, type ProjectInput } from "../src/app.js";
import { creationErrorText, validRepositoryName, type CreatedRepository } from "../src/project.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

type Ctx = ReturnType<typeof testFactory>;
const file = (ctx: Ctx) => readFileSync(ctx.home.config, "utf8");

/** A fake GitHub and git: records what was created and cloned, and clones with a plain git init. */
function fakes(over: { repo?: Partial<CreatedRepository>; createError?: unknown; cloneError?: Error } = {}) {
  const created: { name: string; private: boolean }[] = [];
  const cloned: string[] = [];
  const asked: string[] = [];
  const said: string[] = [];
  const input = {
    token: () => "ghp_fake",
    say: (text: string) => said.push(text),
    create: async (req: { name: string; private: boolean }) => {
      created.push(req);
      if (over.createError) throw over.createError;
      const name = req.name.includes("/") ? req.name : `me/${req.name}`;
      return { fullName: name, cloneUrl: `https://github.com/${name}.git`, htmlUrl: `https://github.com/${name}`, defaultBranch: "main", private: req.private, ...over.repo };
    },
    clone: async (_url: string, dir: string) => {
      cloned.push(dir);
      if (over.cloneError) throw over.cloneError;
      const r = spawnSync("git", ["init", "-q", "-b", "main", dir], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr);
    },
  } satisfies Partial<ProjectInput>;
  const confirm = (answer: boolean) => async (question: string) => {
    asked.push(question);
    return answer;
  };
  return { input, created, cloned, asked, said, confirm };
}

const factory = () => testFactory({ isolation: "worktree", lines: [{ name: "demo", repo: gitRepo() }] });
const githubError = (status: number, message = "boom") => Object.assign(new Error(message), { status });

describe("repository names", () => {
  it("takes nombre and cuenta/nombre and refuses the rest", () => {
    expect(validRepositoryName("demo-x")).toBe(true);
    expect(validRepositoryName("acme/demo_x.web")).toBe(true);
    expect(validRepositoryName("mi demo!")).toBe(false);
    expect(validRepositoryName("a/b/c")).toBe(false);
    expect(validRepositoryName("..")).toBe(false);
    expect(validRepositoryName("")).toBe(false);
  });
});

describe("createProject approval", () => {
  it("creates nothing when the confirmation is declined", async () => {
    const ctx = factory();
    const before = file(ctx);
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(false) });
    expect(f.asked).toHaveLength(1);
    expect(f.created).toEqual([]);
    expect(f.cloned).toEqual([]);
    expect(file(ctx)).toBe(before);
    expect(existsSync(ctx.home.projects) ? readdirSync(ctx.home.projects) : []).toEqual([]);
    expect(r).toMatchObject({ ok: false, created: false });
    expect(r.text).toContain("No creé nada");
  });

  it("creates nothing without a confirm function", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x" });
    expect(f.created).toEqual([]);
    expect(r.created).toBe(false);
  });

  it("creates once, private, when accepted", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(r.ok).toBe(true);
    expect(f.created).toEqual([{ name: "demo-x", private: true }]);
  });

  it("says the plan before asking", async () => {
    const ctx = factory();
    const f = fakes();
    let saidBefore = "";
    await createProject(ctx, {
      ...f.input,
      name: "demo-x",
      confirm: async () => {
        saidBefore = f.said.join("\n");
        return false;
      },
    });
    expect(saidBefore).toContain("demo-x");
    expect(saidBefore).toContain("privado");
    expect(saidBefore).toContain(join(ctx.home.projects, "demo-x"));
  });
});

describe("createProject visibility", () => {
  it("is public only on request", async () => {
    const ctx = factory();
    const f = fakes();
    await createProject(ctx, { ...f.input, name: "demo-x", publico: true, confirm: f.confirm(true) });
    expect(f.created).toEqual([{ name: "demo-x", private: false }]);
    expect(f.said.join("\n")).toContain("público");
  });

  it("refuses a public coordination repository", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "zero-coord", coordination: true, publico: true, confirm: f.confirm(true) });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("tiene que ser privado");
    expect(f.created).toEqual([]);
  });
});

describe("createProject validation", () => {
  it("refuses a bad name before asking", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "mi demo!", confirm: f.confirm(true) });
    expect(r.text).toContain("no es un nombre de repositorio válido");
    expect(f.asked).toEqual([]);
    expect(f.created).toEqual([]);
  });

  it("refuses a line name that is taken", async () => {
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "demo-x", repo: gitRepo() }] });
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(r.text).toContain("Ya existe la línea");
    expect(f.created).toEqual([]);
  });

  it("refuses a clone folder that already exists", async () => {
    const ctx = factory();
    const f = fakes();
    spawnSync("git", ["init", "-q", join(ctx.home.projects, "demo-x")]);
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(r.text).toContain("Ya existe la carpeta");
    expect(f.created).toEqual([]);
  });

  it("says there is no GitHub token and points to zero setup", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, token: () => undefined, name: "demo-x", confirm: f.confirm(true) });
    expect(r.text).toContain("No hay token de GitHub");
    expect(r.text).toContain("zero setup");
    expect(f.created).toEqual([]);
    expect(f.asked).toEqual([]);
  });
});

describe("createProject errors from GitHub", () => {
  it("names the missing permission on 403 and 404", async () => {
    for (const status of [403, 404]) {
      const ctx = factory();
      const f = fakes({ createError: githubError(status, "Resource not accessible by personal access token") });
      const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
      expect(r.ok).toBe(false);
      expect(r.created).toBe(false);
      expect(r.text).toContain("el token de GitHub no tiene permiso para crear repositorios");
      expect(r.text).toContain("Administration");
      expect(r.text).toContain("`repo`");
      expect(f.cloned).toEqual([]);
    }
  });

  it("mentions the organization for cuenta/nombre", () => {
    expect(creationErrorText("acme/demo", githubError(403))).toContain("miembro de esa organización");
  });

  it("says the name is taken on 422", async () => {
    const ctx = factory();
    const f = fakes({ createError: githubError(422) });
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(r.text).toContain("ya existe un repositorio con ese nombre en GitHub");
  });

  it("says the token is invalid or expired on 401", async () => {
    const ctx = factory();
    const f = fakes({ createError: githubError(401) });
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(r.text).toContain("el token de GitHub es inválido o está vencido");
  });
});

describe("createProject line", () => {
  it("clones into the projects folder and adds a pull-request line", async () => {
    const ctx = factory();
    writeFileSync(ctx.home.config, `# mis comentarios\n${file(ctx)}`);
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    const dir = join(ctx.home.projects, "demo-x");
    expect(r).toMatchObject({ ok: true, created: true, line: "demo-x", url: "https://github.com/me/demo-x" });
    expect(f.cloned).toEqual([dir]);
    const line = ctx.config.lines.find((l) => l.name === "demo-x");
    expect(line).toMatchObject({ repo: dir, baseBranch: "main", integrate: "pull-request", verify: [], setup: [] });
    expect(file(ctx)).toContain("# mis comentarios");
    expect(file(ctx)).toContain("name: demo-x");
    expect(file(ctx)).toContain("integrate: pull-request");
  });

  it("names the line after the repository and takes its default branch", async () => {
    const ctx = factory();
    const f = fakes({ repo: { defaultBranch: "trunk" } });
    await createProject(ctx, { ...f.input, name: "acme/Demo.Web", confirm: f.confirm(true) });
    expect(f.created).toEqual([{ name: "acme/Demo.Web", private: true }]);
    expect(ctx.config.lines.find((l) => l.name === "demo-web")).toMatchObject({ repo: join(ctx.home.projects, "demo-web"), baseBranch: "trunk" });
  });

  it("uses the given commands", async () => {
    const ctx = factory();
    const f = fakes();
    await createProject(ctx, { ...f.input, name: "demo-x", verify: ["npm test"], setup: ["npm ci"], confirm: f.confirm(true) });
    expect(ctx.config.lines.find((l) => l.name === "demo-x")).toMatchObject({ verify: ["npm test"], setup: ["npm ci"] });
  });

  it("says the repository was created but adds no line when the clone fails", async () => {
    const ctx = factory();
    const before = file(ctx);
    const f = fakes({ cloneError: new Error("Authentication failed") });
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(r).toMatchObject({ ok: false, created: true });
    expect(r.text).toContain("Creé el repositorio me/demo-x");
    expect(r.text).toContain("https://github.com/me/demo-x");
    expect(r.text).toContain("no pude clonarlo");
    expect(r.text).toContain("No borré nada en GitHub");
    expect(file(ctx)).toBe(before);
    expect(ctx.config.lines.map((l) => l.name)).toEqual(["demo"]);
    expect(f.created).toHaveLength(1);
  });
});

describe("createProject first job", () => {
  it("queues the request on the new line", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x", pedido: "Demo para la empresa X con turnos online", confirm: f.confirm(true) });
    const jobs = ctx.store.listJobs().filter((j) => j.line === "demo-x");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "queued", request: "Demo para la empresa X con turnos online" });
    expect(r.job).toBe(jobs[0]!.id);
    expect(r.text).toContain(jobs[0]!.id);
    expect(f.said.join("\n")).toContain("Demo para la empresa X");
  });

  it("creates no job without a request and says how to ask for one", async () => {
    const ctx = factory();
    const f = fakes();
    const r = await createProject(ctx, { ...f.input, name: "demo-x", confirm: f.confirm(true) });
    expect(ctx.store.listJobs()).toEqual([]);
    expect(r.job).toBeUndefined();
    expect(r.text).toContain("zero request");
    expect(r.text).toContain("--line demo-x");
  });
});

describe("createProject coordination", () => {
  it("creates a private repository and joins it, without clone or line", async () => {
    const ctx = factory();
    const f = fakes({ repo: { fullName: "me/zero-coord", private: true } });
    const r = await createProject(ctx, { ...f.input, name: "zero-coord", coordination: true, confirm: f.confirm(true) });
    expect(r.ok).toBe(true);
    expect(f.created).toEqual([{ name: "zero-coord", private: true }]);
    expect(f.cloned).toEqual([]);
    expect(ctx.config.lines.map((l) => l.name)).toEqual(["demo"]);
    expect(ctx.config.distributed).toMatchObject({ repository: "me/zero-coord" });
    expect(file(ctx)).toMatch(/distributed:\s*\n\s+repository: me\/zero-coord/);
    expect(r.text).toContain("me/zero-coord");
  });

  it("does not check the line or the folder for coordination", async () => {
    const ctx = testFactory({ isolation: "worktree", lines: [{ name: "zero-coord", repo: gitRepo() }] });
    const f = fakes({ repo: { fullName: "me/zero-coord", private: true } });
    const r = await createProject(ctx, { ...f.input, name: "zero-coord", coordination: true, confirm: f.confirm(true) });
    expect(r.ok).toBe(true);
    expect(f.created).toHaveLength(1);
  });
});
