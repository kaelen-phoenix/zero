import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGate, GATE_PORT } from "./gate.js";

/**
 * Entry point of the egress gate's container. Writes `ready` with the start
 * nonce once listening, so the host knows this very instance is up.
 */
const dir = process.env.ZERO_GATE_DIR ?? "/gate";
mkdirSync(join(dir, "runs"), { recursive: true });
const server = createGate({ dir });
server.listen(GATE_PORT, "0.0.0.0", () => {
  writeFileSync(join(dir, "ready"), process.env.ZERO_GATE_START ?? "");
  process.stdout.write(`zero gate listening on ${GATE_PORT}\n`);
});
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
