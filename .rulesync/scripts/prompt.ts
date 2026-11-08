/** TTY prompts. Copied into consumers. */
import * as clack from "@clack/prompts";

type SelectOptions<Value> = Parameters<typeof clack.select<Value>>[0];
type MultiselectOptions<Value> = Parameters<typeof clack.multiselect<Value>>[0];

export { isInteractive } from "./interactive.ts";

export function bailIfCancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Aborted");
    process.exit(0);
  }
  return value as T; // isCancel above exits on the symbol, so only T is left
}

export async function select<Value>(opts: SelectOptions<Value>): Promise<Value> {
  return bailIfCancel(await clack.select(opts));
}

export async function multiselect<Value>(opts: MultiselectOptions<Value>): Promise<Value[]> {
  return bailIfCancel(await clack.multiselect(opts));
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

export function spinner() {
  return clack.spinner();
}
