import type { JsonObject } from "../../json.ts";
import type { ParsedDoc } from "./frontmatter.ts";
import type { Variant } from "./variants.ts";

/** One rule or subagent source file. */
export type Doc = {
  /** POSIX path from its root, for messages: `agents/rules/overview.md`, `.repo/subagents/x/y.md`. */
  rel: string;
  /** POSIX path inside `rules/` or `subagents/`, which outputs are named after: `overview.md`, `x/y.md`. */
  file: string;
  /** `stock` for the installed package's `agents/`, `repo` for anything under a `.repo/`, root or package. */
  origin: "stock" | "repo";
  /** `""` for stock and the root `.repo/`; the package dir (`packages/web`) for a package's `.repo/`. */
  scope: string;
} & ParsedDoc;

/** A listed source file, before it is read. */
export type DocFile = {
  abs: string;
  rel: string;
  file: string;
  origin: Doc["origin"];
  scope: string;
  /** The `variants:` entry this file stands for, when its source holds several subagents. */
  variant?: Variant;
};

/** The two doc kinds a root holds. */
export type Kind = "rules" | "subagents";

/** The hooks file that won, root-relative, and its parsed object. */
export type HooksSource = {
  rel: string;
  value: JsonObject;
};

/** The merged inputs every agent generator reads. */
export type Sources = {
  rules: Doc[];
  /** In merge order; subagents.ts re-sorts them shallowest-first as rulesync did. */
  subagents: Doc[];
  hooks: HooksSource;
};

/**
 * The docs that loaded and every problem found, each starting with the file it is about. A doc with a problem is left
 * out of `sources`, and so is a hooks file that failed (its `value` is then empty); a load with problems is not to be
 * rendered.
 */
export type LoadResult = {
  sources: Sources;
  problems: string[];
};
