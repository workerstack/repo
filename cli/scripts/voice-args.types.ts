export interface ParsedArgv {
  _: string[];
  flags: Record<string, string>;
}

/** A parsed JSON object whose fields are not yet checked. */
export type JsonObject = Record<string, unknown>;
