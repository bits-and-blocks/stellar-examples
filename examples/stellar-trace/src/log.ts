/**
 * Structured logs.
 *
 * One line per event, `text` when stdout is a terminal and `json` when it is
 * not — so watching a run reads like a program and piping one into `jq` is a
 * table. The fields are the same either way; only the framing changes.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
};

export type LogFormat = "text" | "json";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const PREFIX: Record<LogLevel, string> = {
  debug: "  ",
  info: "  ",
  warn: "! ",
  error: "x ",
};

export function createLogger(options: {
  format?: LogFormat;
  level?: LogLevel;
  write?: (line: string) => void;
} = {}): Logger {
  const format = options.format ?? (process.stdout.isTTY ? "text" : "json");
  const threshold = LEVELS[options.level ?? "info"];
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  const emit = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    if (LEVELS[level] < threshold) return;
    const ts = new Date().toISOString();
    if (format === "json") {
      write(JSON.stringify({ ts, level, msg, ...fields }));
      return;
    }
    const rendered = Object.entries(fields)
      .map(([key, value]) => `${key}=${format_(value)}`)
      .join(" ");
    write(`${PREFIX[level]}${msg}${rendered ? `  ${rendered}` : ""}`);
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

const format_ = (value: unknown): string =>
  typeof value === "string" && !/\s/.test(value) ? value : JSON.stringify(value);
