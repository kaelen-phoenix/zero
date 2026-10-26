import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Runtime } from "./runtime.js";

/** The installed zero package: what the box image is built from. */
export function zeroRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

/** Files the image copies from the zero package. The image tag is their content hash. */
const CONTEXT = ["package.json", "package-lock.json", "dist", "agents", "box/Dockerfile"];

function files(root: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) for (const entry of readdirSync(path).sort()) walk(join(path, entry));
    else out.push(path);
  };
  for (const entry of CONTEXT) walk(join(root, entry));
  return out;
}

/** `zero-box:<hash>`: any change to zero's code or dependencies yields a new image. */
export function imageTag(root = zeroRoot()): string {
  const hash = createHash("sha256");
  for (const file of files(root)) {
    hash.update(relative(root, file).replace(/\\/g, "/"));
    hash.update(readFileSync(file));
  }
  return `zero-box:${hash.digest("hex").slice(0, 12)}`;
}

/** Copies only the image's inputs to a temporary build context. */
export function buildContext(root = zeroRoot()): string {
  if (!existsSync(join(root, "dist", "box", "agent.js"))) throw new Error(`No existe ${join(root, "dist")}: compilá zero (\`npm run build\`) antes de construir la caja.`);
  const dir = mkdtempSync(join(tmpdir(), "zero-box-"));
  for (const entry of CONTEXT) if (existsSync(join(root, entry))) cpSync(join(root, entry), join(dir, entry), { recursive: true });
  return dir;
}

/** Builds the box image, streaming the runtime's output to `onOutput`. */
export function buildImage(rt: Runtime, tag: string, onOutput: (chunk: string) => void = () => {}, root = zeroRoot()): Promise<void> {
  const context = buildContext(root);
  return new Promise((resolve, reject) => {
    const child = spawn(rt, ["build", "-t", tag, "-f", join(context, "box", "Dockerfile"), context], { windowsHide: true });
    child.stdout.on("data", (d) => onOutput(String(d)));
    child.stderr.on("data", (d) => onOutput(String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      rmSync(context, { recursive: true, force: true });
      code === 0 ? resolve() : reject(new Error(`${rt} build terminó con código ${code}`));
    });
  });
}
