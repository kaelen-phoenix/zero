type Fields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", msg: string, fields?: Fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === "info" ? console.log : console.error)(line);
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
