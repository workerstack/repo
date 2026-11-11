/** A parsed JSON or TOML table. */
export type JsonObject = Record<string, unknown>;

/** The parsed `repo purge-mcps` command line, or why it is bad. */
export type ParsedArgv = { ok: true; apply: boolean } | { ok: false; error: string };

/** The grok config's plan: skip it, or write `obj` as its new TOML. */
export interface GrokPlan {
  abs: string;
  skip: boolean;
  detail: string;
  changed?: boolean;
  obj: JsonObject | null;
}

/** A JSON dest's plan: skip it, or write `json` as its new text. */
export interface JsonPlan {
  abs: string;
  skip: boolean;
  detail: string;
  changed?: boolean;
  json: JsonObject | null;
}

/** One report line: the action, the dest and what changed there. */
export interface ReportRow {
  action: string;
  path: string;
  detail: string;
  line: string;
}

/** A purge's report, and its error when it failed. */
export interface PurgeResult {
  ok: boolean;
  report: ReportRow[];
  error?: string;
}
