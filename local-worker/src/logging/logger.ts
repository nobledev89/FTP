import { redactValue } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export type LogSink = {
  write(line: string, level: LogLevel): void;
};

const consoleSink: LogSink = {
  write(line, level) {
    if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  },
};

export class StructuredLogger {
  constructor(
    private readonly base: LogFields = {},
    private readonly sink: LogSink = consoleSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  child(fields: LogFields): StructuredLogger {
    return new StructuredLogger({ ...this.base, ...fields }, this.sink, this.now);
  }

  debug(event: string, fields: LogFields = {}): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write("error", event, fields);
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const record = redactValue({
      timestamp: this.now().toISOString(),
      level,
      event,
      ...this.base,
      ...fields,
    });
    this.sink.write(JSON.stringify(record), level);
  }
}
