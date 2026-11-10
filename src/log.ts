type Fields = Record<string, unknown>;

let lost = 0;

/** Log lines that could not be written since the process started. */
export const lostLogLines = () => lost;

/**
 * A log line that cannot be written is dropped and counted, never thrown: with the machine out of memory or
 * the disk of the log full, a write that fails must not take down whoever was logging.
 */
function emit(level: "info" | "warn" | "error", msg: string, fields?: Fields) {
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
    (level === "info" ? console.log : console.error)(line);
  } catch {
    lost++;
  }
}

const guarded = new WeakSet<object>();

/**
 * Keeps a failed write to stdout or stderr from ending the process: Node reports some of them later, as an
 * 'error' event on the stream, and an 'error' nobody listens to is a crash. For a process that must stay up (the daemon).
 */
export function guardLogStreams(streams: Pick<NodeJS.WriteStream, "on">[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    if (guarded.has(stream)) continue;
    guarded.add(stream);
    stream.on("error", () => void lost++);
  }
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
