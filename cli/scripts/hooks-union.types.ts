/** The shapes the hooks union reads and writes. */

/** One hook command entry as the union writes it. */
export type HookEntry = {
  type: string;
  command: string;
  timeout?: number;
};

/** A `{matcher, hooks}` group as the union writes it. */
export type HookGroup = {
  matcher: string;
  hooks: HookEntry[];
};

/** A flat Antigravity entry: the consumer hook plus the event it joins. */
export type NamedHook = {
  event: string;
  matcher?: string;
  command: string;
};

export type JsonObject = Record<string, unknown>;

/** The three roots one union run reads and writes. */
export type Roots = {
  ws: string;
  src: string;
  consumer: string;
};
