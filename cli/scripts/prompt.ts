/** TTY prompts. Copied into consumers. */
import * as clack from "@clack/prompts";

type SelectOptions<Value> = Parameters<typeof clack.select<Value>>[0];

export { isInteractive } from "./is-interactive.ts";

export function bailIfCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Aborted");
    process.exit(0);
  }
  return value; /* isCancel above exits on the symbol, so only T is left */
}

export async function select<Value>(opts: SelectOptions<Value>): Promise<Value> {
  return bailIfCancel(await clack.select(opts));
}

export async function confirm(opts: Parameters<typeof clack.confirm>[0]): Promise<boolean> {
  return bailIfCancel(await clack.confirm(opts));
}

export async function text(opts: Parameters<typeof clack.text>[0]): Promise<string> {
  return bailIfCancel(await clack.text(opts));
}

export async function password(opts: Parameters<typeof clack.password>[0]): Promise<string> {
  return bailIfCancel(await clack.password(opts));
}

export function spinner(): {
  start: (msg?: string) => void;
  stop: (msg?: string, code?: number) => void;
  message: (msg?: string) => void;
} {
  return clack.spinner();
}
