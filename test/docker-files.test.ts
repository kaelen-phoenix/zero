import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

interface Service {
  volumes: string[];
  environment: Record<string, string>;
  ports?: string[];
  secrets?: string[];
  user?: string;
  init?: boolean;
  build?: { args?: Record<string, string> };
}

const service = (path: string) => (parse(read(path)) as { services: { zero: Service } }).services.zero;

describe("docker/Dockerfile", () => {
  const file = read("docker/Dockerfile");

  it("builds on Node 22 and takes the CLIs from ZERO_CLIS", () => {
    expect(file).toMatch(/^FROM node:22/m);
    expect(file).toMatch(/^ARG ZERO_CLIS/m);
    expect(file).toContain("@anthropic-ai/claude-code");
    expect(file).toContain("@openai/codex");
  });

  it("installs git, gh and the Docker client", () => {
    expect(file).toMatch(/apt-get install[^\n]*\bgit\b/);
    expect(file).toMatch(/apt-get install[^\n]*\bgh\b/);
    expect(file).toContain("docker-ce-cli");
  });

  it("keeps what the box image is built from", () => {
    for (const piece of ["COPY package.json package-lock.json ./", "./dist", "COPY agents ./agents", "COPY box/Dockerfile ./box/Dockerfile"]) expect(file).toContain(piece);
    expect(read("src/box/image.ts")).toContain('["package.json", "package-lock.json", "dist", "agents", "box/Dockerfile"]');
  });

  it("runs as an unprivileged user, marked as a container, starting the factory", () => {
    const users = [...file.matchAll(/^USER (\S+)/gm)].map((m) => m[1]);
    expect(users.length).toBeGreaterThan(0);
    expect(users).not.toContain("root");
    expect(users).not.toContain("0");
    expect(file).toMatch(/ENV ZERO_CONTAINER=1/);
    expect(file).toMatch(/^ENTRYPOINT \[.*dist\/cli\.js"\]$/m);
    expect(file).toMatch(/^CMD \["start"\]$/m);
  });

  it("hands git zero's token for github.com only", () => {
    expect(file).toContain("credential.https://github.com.helper");
    expect(file).toContain("git-credential");
  });

  it("keeps no credentials out of the build context by accident", () => {
    const ignored = read(".dockerignore");
    expect(ignored.split("\n")[0]).toBe("*");
    expect(ignored).not.toContain("secrets");
    expect(read(".gitignore").split("\n")).toContain("secrets/");
  });
});

describe("compose.yaml", () => {
  const zero = service("compose.yaml");

  it("keeps the data, HOME and repositories in volumes", () => {
    const data = zero.volumes.find((v) => v.endsWith(":/data"));
    expect(data).toBeDefined();
    expect(data!.startsWith("/")).toBe(false);
    expect(zero.environment.ZERO_HOME).toMatch(/^\/data\//);
    expect(zero.environment.HOME).toMatch(/^\/data\//);
    expect(zero.volumes.some((v) => v.endsWith(":/repos"))).toBe(true);
    const named = Object.keys((parse(read("compose.yaml")) as { volumes: Record<string, unknown> }).volumes);
    for (const v of zero.volumes) expect(named).toContain(v.split(":")[0]);
  });

  it("does not mount the Docker socket nor declare credentials", () => {
    expect(read("compose.yaml")).not.toContain("docker.sock");
    for (const key of Object.keys(zero.environment)) expect(key).not.toMatch(/_(KEY|TOKEN)$/);
  });

  it("publishes the panel on ZERO_PANEL_PORT, bound to 127.0.0.1 by default", () => {
    expect(zero.ports).toEqual(["${ZERO_PANEL_BIND:-127.0.0.1}:${ZERO_PANEL_PORT:-4848}:${ZERO_PANEL_PORT:-4848}"]);
  });

  it("connects the master key as a Docker secret, outside the volume", () => {
    expect(zero.secrets).toEqual(["zero_master_key"]);
    expect((parse(read("compose.yaml")) as { secrets: Record<string, { file: string }> }).secrets.zero_master_key!.file).toBe("./secrets/zero_master_key");
  });

  it("runs with an init, as the configured user, with the chosen CLIs", () => {
    expect(zero.init).toBe(true);
    expect(zero.user).toBe("${ZERO_UID:-1000}:${ZERO_GID:-1000}");
    expect(zero.build?.args?.ZERO_CLIS).toContain("ZERO_CLIS");
  });
});

describe("docker/compose.box.yaml", () => {
  const zero = service("docker/compose.box.yaml");

  it("mounts the socket and the data folder at the same path, with ZERO_DATA required", () => {
    expect(zero.volumes).toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(zero.volumes).toContain("${ZERO_DATA}:${ZERO_DATA}");
    expect(zero.environment.ZERO_DATA).toMatch(/^\$\{ZERO_DATA:\?/);
    expect(zero.environment.ZERO_HOME!.startsWith("${ZERO_DATA}")).toBe(true);
    expect(zero.environment.TMPDIR!.startsWith("${ZERO_DATA}")).toBe(true);
    expect(zero.environment.HOME!.startsWith("${ZERO_DATA}")).toBe(true);
  });
});

describe("docs/adr/0003-fabrica-en-docker.md", () => {
  it("records the isolation and secrets decisions", () => {
    const adr = read("docs/adr/0003-fabrica-en-docker.md");
    for (const piece of ["socket", "--privileged", "worktree", "zero_master_key"]) expect(adr).toContain(piece);
  });
});
