/** TTY prompts. Copied into consumers. */
import * as clack from "@clack/prompts";

type SelectOptions<Value> = Parameters<typeof clack.select<Value>>[0];

/** The @clack/prompts calls the prompts make; a test passes fakes. */
export type Clack = Pick<typeof clack, "cancel" | "confirm" | "isCancel" | "password" | "select" | "spinner" | "text">;

type Spinner = {
  start: (msg?: string) => void;
  stop: (msg?: string, code?: number) => void;
  message: (msg?: string) => void;
};

/** Each prompt over one clack: a cancel prints `Aborted` and exits 0, else the answer comes back. */
type Prompts = {
  bailIfCancel: <T>(value: T | symbol) => T;
  select: <Value>(opts: SelectOptions<Value>) => Promise<Value>;
  confirm: (opts: Parameters<typeof clack.confirm>[0]) => Promise<boolean>;
  text: (opts: Parameters<typeof clack.text>[0]) => Promise<string>;
  password: (opts: Parameters<typeof clack.password>[0]) => Promise<string>;
  spinner: () => Spinner;
};

export { isInteractive } from "./is-interactive.ts";

/** The prompts over `lib`. */
export function promptsOf(lib: Clack): Prompts {
  function bail<T>(value: T | symbol): T {
    if (lib.isCancel(value)) {
      lib.cancel("Aborted");
      process.exit(0);
    }

    return value; /* isCancel above exits on the symbol, so only T is left */
  }

  return {
    bailIfCancel: bail,
    confirm: async (opts) => bail(await lib.confirm(opts)),
    password: async (opts) => bail(await lib.password(opts)),
    select: async (opts) => bail(await lib.select(opts)),
    spinner: () => lib.spinner(),
    text: async (opts) => bail(await lib.text(opts)),
  };
}

export function bailIfCancel<T>(value: T | symbol): T {
  return promptsOf(clack).bailIfCancel(value);
}

export function select<Value>(opts: SelectOptions<Value>): Promise<Value> {
  return promptsOf(clack).select(opts);
}

export function confirm(opts: Parameters<typeof clack.confirm>[0]): Promise<boolean> {
  return promptsOf(clack).confirm(opts);
}

export function text(opts: Parameters<typeof clack.text>[0]): Promise<string> {
  return promptsOf(clack).text(opts);
}

export function password(opts: Parameters<typeof clack.password>[0]): Promise<string> {
  return promptsOf(clack).password(opts);
}

export function spinner(): Spinner {
  return promptsOf(clack).spinner();
}
