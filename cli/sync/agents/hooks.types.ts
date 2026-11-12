/** A parsed JSON object: a hooks.jsonc block, a handler definition or a written hook. */
export type Json = Record<string, unknown>;

/** One handler definition as hooks.jsonc writes it. */
export type Def = Json;

/** One matcher group of a host's event: `{matcher, hooks}`, or `{hooks}` when the event takes no matcher. */
export type Group = { matcher?: string; hooks: Json[] };

/**
 * One passthrough field (D:53298-53339): written when valid for its kind (D:53378-53385, `isStringArray` D:4415),
 * and only on command hooks when `commandOnly`. `onFailure` is claude's keyword field (D:55667-55678, D:53527-53572):
 * `failClosed: true` becomes `onFailure: "block"` on command and http hooks, except on the events claude ignores
 * it on and on command hooks that set `async` or `asyncRewake`.
 */
export type Passthrough =
  | { key: string; kind: "boolean" | "number" | "string" | "array"; commandOnly?: true }
  | { key: "onFailure"; kind: "keyword" };

/**
 * How one matcher-group host converts a definition (the converter configs at D:55604-55631, D:56372-56378,
 * D:54389-54398).
 */
export type Target = {
  overrideKey: string;
  names: Readonly<Record<string, string>>;
  /** Events whose groups carry no matcher; translation is skipped there too (D:53195, D:53796). */
  noMatcher: ReadonlySet<string>;
  /** Hook types written; others are skipped (D:53520, D:53681). */
  types: ReadonlySet<string>;
  command?: (command: string, def: Def) => string;
  /** Hook fields copied through, in the order rulesync writes them, ahead of `type` (D:53582-53640). */
  passthrough: readonly Passthrough[];
  matcher?: (matcher: string) => string;
  /** Whether prompt and agent hooks carry `model` (D:55632 `emitsPromptModel`). */
  promptModel: boolean;
  /** Whether `name` and `description` are written (codex `passthroughFields`, D:56378). */
  named: boolean;
};
