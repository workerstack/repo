import type { TomlTable } from "smol-toml";

import type { JsonObject } from "../json.ts";

/** The parsed `repo purge-mcps` command line, or why it is bad. */
export type ParsedArgv = { ok: true; apply: boolean } | { ok: false; error: string };

/** The grok config's plan: skip it, or write `obj` as its new TOML. */
export type GrokPlan = {
  abs: string;
  skip: boolean;
  detail: string;
  changed?: boolean;
  obj: TomlTable | null;
};

/** A JSON dest's plan: skip it, or write `json` as its new text. */
export type JsonPlan = {
  abs: string;
  skip: boolean;
  detail: string;
  changed?: boolean;
  json: JsonObject | null;
};

/** One report line: the action, the dest and what changed there. */
export type ReportRow = {
  action: string;
  path: string;
  detail: string;
  line: string;
};

/** A purge's report, and its error when it failed. */
export type PurgeResult = {
  ok: boolean;
  report: ReportRow[];
  error?: string;
};
