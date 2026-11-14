/**
 * Rule outputs. A pathless stock rule folds into `AGENTS.md`, which every host reads; the repo's own always-on text is
 * written in `AGENTS.md` by hand, so a pathless repo rule renders there no more, save one that overrides a stock rule:
 * it renders where the stock one was. A rule with `paths` is written where the host scopes it: `.claude/rules/` with a
 * `paths:` list for claude and `.agents/rules/` with a glob trigger for antigravity. Codex, grok and cursor cannot
 * scope, so when any of them is on, `AGENTS.md` ends with a `## Rules by path` list that points at each path rule's
 * source file. `description` and `overrides` never render. In the root `AGENTS.md`, a line that starts with the
 * workflow anchor renders as the paragraph of the repo's `workflow`; under worktree it renders as written.
 */
import type { Host } from "../../config.ts";
import { isString } from "../../json.ts";
import type { Effort } from "../../scripts/strategy.types.ts";
import type { Workflow } from "../../workflow.ts";
import { PACKAGE_NAME } from "../package-name.constants.ts";
import { emitYaml, finalize } from "./frontmatter.ts";
import type { Doc } from "./sources.types.ts";
import { LINE_END, WORKFLOW_ANCHOR, WORKFLOW_PARAGRAPHS } from "./workflow-paragraph.constants.ts";

/** Hosts that read only `AGENTS.md` and so need the path rules listed there. */
const UNSCOPED_HOSTS: readonly Host[] = ["codex", "grok", "cursor"];

/** The globs a rule applies to; none when it has no `paths` or they cover every file. */
export function scopeOf(doc: Doc): string[] {
  const paths = (doc.data["paths"] /* loadSources checked paths is a list of strings */ as string[] | undefined) ?? [];

  return paths.length === 1 && (paths[0] === "**/*" || paths[0] === "*") ? [] : paths;
}

/** Where a reader finds the rule's source from the repo root: stock lives in the installed package. */
function sourcePath(doc: Doc): string {
  return doc.origin === "repo" ? doc.rel : `node_modules/${PACKAGE_NAME}/${doc.rel}`;
}

/** One planned rule file: its text and the source it comes from, for a message when two scopes plan one path. */
export type RuleFile = {
  text: string;
  source: string;
};

/** The line that opens every package `AGENTS.md`. */
const PACKAGE_POINTER = "Start at references/INDEX.md in this package.";

/**
 * One scope's rules: its dir (`""` for the root and stock), the hosts that are on, the repo's default effort, and the
 * workflow the root `AGENTS.md` describes.
 */
export type Scoped = { scope: string; hosts: readonly Host[]; effort: Effort; workflow: Workflow };

/** A root section with each line that starts with the workflow anchor swapped for the paragraph of `workflow`. */
function withWorkflow(body: string, workflow: Workflow): string {
  if (workflow === "worktree") return body;

  return body
    .split(LINE_END)
    .map((line) => (line.startsWith(WORKFLOW_ANCHOR) ? WORKFLOW_PARAGRAPHS[workflow] : line))
    .join("\n");
}

/** The line that ends the root `AGENTS.md`: the plan skills a change gets when no skill was named. */
function planRoute(effort: Effort): string {
  return (
    `When a change needs a plan and no skill was named, use /write-plan-${effort} and /implement-plan-${effort}, ` +
    `or /write-roadmap-${effort} and /implement-roadmap-${effort} for two or more slices.`
  );
}

/** A rule's globs, prefixed with the scope's dir. */
function globsOf(doc: Doc, scope: string): string[] {
  return scopeOf(doc).map((glob) => (scope === "" ? glob : `${scope}/${glob}`));
}

/**
 * The `AGENTS.md` of a scope: its pathless sections, then a pointer per path rule when an unscoped host is on; the
 * root's ends with the plan route for the effort.
 */
function agentsText(own: readonly Doc[], { scope, hosts, effort, workflow }: Scoped): string {
  const scoped = own.filter((doc) => scopeOf(doc).length > 0);

  const sections = own
    .filter((doc) => scopeOf(doc).length === 0)
    .filter((doc) => doc.origin !== "repo" || isString(doc.data["overrides"]))
    .map((doc) => doc.body.trim())
    .filter((body) => body !== "")
    .map((body) => (scope === "" ? withWorkflow(body, workflow) : body));

  if (scoped.length > 0 && hosts.some((host) => UNSCOPED_HOSTS.includes(host))) {
    const lines = scoped.map((doc) => `- \`${globsOf(doc, scope).join(" ")}\`: read \`${sourcePath(doc)}\``);
    sections.push(`## Rules by path\n${lines.join("\n")}`);
  }

  return finalize((scope === "" ? [...sections, planRoute(effort)] : [PACKAGE_POINTER, ...sections]).join("\n\n"));
}

/** The claude and antigravity files of one rule, under the scope's dir; a pathless one covers the whole dir. */
function hostFiles(doc: Doc, { scope, hosts }: Pick<Scoped, "hosts" | "scope">, out: Map<string, RuleFile>): void {
  const globs = scopeOf(doc).length === 0 ? [`${scope}/**`] : globsOf(doc, scope);
  const nested = scope === "" ? doc.file : `${scope}/${doc.file}`;

  if (hosts.includes("claude")) {
    const text = finalize(`---\n${emitYaml([["paths", globs]])}---\n${doc.body}`);
    out.set(`.claude/rules/${nested}`, { source: doc.rel, text });
  }

  if (hosts.includes("antigravity")) {
    const fm = emitYaml([
      ["trigger", "glob"],
      ["globs", globs.join(",")],
    ]);

    out.set(`.agents/rules/${nested}`, { source: doc.rel, text: finalize(`---\n${fm}---\n${doc.body}`) });
  }
}

/**
 * The files of one scope's rules (`""` for the root and stock, a package dir for a package), given the hosts that are
 * on, by POSIX path. The root `AGENTS.md` holds the pathless stock rules and a pointer per path rule; a package's holds
 * the pointer line first, and its globs are prefixed with the dir. Every one of a package's rules, pathless ones as
 * `<dir>/**`, is written for claude and antigravity under `<dir>/`. The root `AGENTS.md` ends with the plan skills of
 * `effort`, and its workflow paragraph is the one of `workflow`.
 */
export function renderRules(rules: readonly Doc[], scoped: Scoped): Map<string, RuleFile> {
  const { hosts, scope } = scoped;
  const out = new Map<string, RuleFile>();

  if (hosts.length === 0) return out;
  const own = rules.filter((doc) => doc.scope === scope);
  const home = scope === "" ? "" : `${scope}/`;
  out.set(`${home}AGENTS.md`, { source: `${home}.repo/rules`, text: agentsText(own, scoped) });
  const written = scope === "" ? own.filter((doc) => scopeOf(doc).length > 0) : own;

  for (const doc of written) hostFiles(doc, { hosts, scope }, out);

  return out;
}
