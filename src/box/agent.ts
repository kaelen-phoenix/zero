import { resolveEngine } from "../engines/index.js";
import { encodeResult, type BoxAgentRequest } from "./protocol.js";

/**
 * Entry point inside the isolation box: reads one request on stdin, runs the
 * engine with the same code the host uses, and prints the result after a
 * marker line. The box's own timeout and cancellation are handled by the host
 * killing the container.
 */
async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { engine, engines, request } = JSON.parse(input) as BoxAgentRequest;
  const cwd = process.env.ZERO_BOX_WORKDIR ?? "/work";
  try {
    const result = await resolveEngine(engine, { engines }).run({ ...request, cwd });
    process.stdout.write(encodeResult(result));
  } catch (err) {
    process.stdout.write(encodeResult({ ok: false, text: `box agent: ${err instanceof Error ? err.message : String(err)}` }));
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(String(err));
    process.exit(1);
  },
);
