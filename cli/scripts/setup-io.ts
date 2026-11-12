/** Where `repo setup` writes: the io's log and error hooks, else stdout and stderr; and the key prompt. */
import { openUrl } from "./setup-oauth.ts";
import type { KeyAsk, SetupCtx, SetupIo } from "./setup.types.ts";
import { str } from "./voice-args.ts";

export function logLine(io: SetupIo | null | undefined, s: string): void {
  if (io?.log === undefined) process.stdout.write(`${s}\n`);
  else io.log(s);
}

export function errLine(io: SetupIo | null | undefined, s: string): void {
  if (io?.error === undefined) process.stderr.write(`${s}\n`);
  else io.error(s);
}

/** The terminal prompts, writing through stdout and stderr. */
export async function defaultIo(): Promise<SetupIo> {
  const { confirm, password, select, text } = await import("./prompt.ts");

  return {
    confirm,
    error: (s: string) => process.stderr.write(`${s}\n`),
    log: (s: string) => process.stdout.write(`${s}\n`),
    password,
    select,
    text,
  };
}

/** Logs `ask.line`, opens `ask.url` and reads a key from the password prompt ("" when the io has none). */
export async function askKey(io: SetupIo, ctx: SetupCtx, ask: KeyAsk): Promise<string> {
  logLine(io, ask.line);
  await openUrl(ask.url, ctx);

  return str(await io.password?.({ message: ask.message }));
}
