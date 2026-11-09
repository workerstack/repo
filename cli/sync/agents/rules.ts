/**
 * Rule outputs. A pathless rule folds into `AGENTS.md`, which every host reads. A rule with `paths` is written where
 * the host scopes it: `.claude/rules/` with a `paths:` list for claude and `.agents/rules/` with a glob trigger for
 * antigravity. Codex, grok and cursor cannot scope, so when any of them is on, `AGENTS.md` ends with a
 * `## Rules by path` list that points at each path rule's source file. `description` and `overrides` never render.
 */
import type { Host } from "../../config.ts";
import { PACKAGE_NAME } from "../stock.ts";
import { emitYaml, finalize } from "./frontmatter.ts";
import type { Doc } from "./sources.ts";

/** Hosts that read only `AGENTS.md` and so need the path rules listed there. */
const UNSCOPED_HOSTS: readonly Host[] = ["codex", "grok", "cursor"];

/** The globs a rule applies to; none when it has no `paths` or they cover every file. */
export function scopeOf(doc: Doc): string[] {
  const paths = (doc.data["paths"] as string[] | undefined) ?? [];
  return paths.length === 1 && (paths[0] === "**/*" || paths[0] === "*") ? [] : paths;
}

/** Where a reader finds the rule's source from the repo root: stock lives in the installed package. */
const sourcePath = (doc: Doc) => (doc.origin === "repo" ? doc.rel : `node_modules/${PACKAGE_NAME}/${doc.rel}`);

/** One planned rule file: its text and the source it comes from, for a message when two scopes plan one path. */
export interface RuleFile {
  text: string;
  source: string;
}

/** The line that opens every package `AGENTS.md`, and is all of its `CLAUDE.md`. */
const PACKAGE_POINTER = "Start at references/INDEX.md in this package.";

/**
 * The files of one scope's rules (`""` for the root and stock, a package dir for a package), given the hosts that are
 * on, by POSIX path. The root `AGENTS.md` holds the pathless rules and a pointer per path rule; a package's holds the
 * pointer line first, and its globs are prefixed with the dir. A package also gets a `CLAUDE.md` with that line alone
 * when claude is on (claude then skips the package `AGENTS.md`, which its `.claude/rules` files already cover), and
 * every one of its rules, pathless ones as `<dir>/**`, is written for claude and antigravity under `<dir>/`.
 */
export function renderRules(rules: readonly Doc[], hosts: readonly Host[], scope: string): Map<string, RuleFile> {
  const out = new Map<string, RuleFile>();
  if (hosts.length === 0) return out;

  const own = rules.filter((doc) => doc.scope === scope);
  const globsOf = (doc: Doc) => scopeOf(doc).map((glob) => (scope === "" ? glob : `${scope}/${glob}`));
  const pathless = own.filter((doc) => scopeOf(doc).length === 0);
  const scoped = own.filter((doc) => scopeOf(doc).length > 0);
  const sections = pathless.map((doc) => doc.body.trim()).filter((body) => body !== "");
  if (scoped.length > 0 && hosts.some((host) => UNSCOPED_HOSTS.includes(host))) {
    const lines = scoped.map((doc) => `- \`${globsOf(doc).join(" ")}\`: read \`${sourcePath(doc)}\``);
    sections.push(`## Rules by path\n${lines.join("\n")}`);
  }
  const home = scope === "" ? "" : `${scope}/`;
  const source = `${home}.repo/rules`;
  out.set(`${home}AGENTS.md`, {
    text: finalize((scope === "" ? sections : [PACKAGE_POINTER, ...sections]).join("\n\n")),
    source,
  });
  if (scope !== "" && hosts.includes("claude"))
    out.set(`${home}CLAUDE.md`, { text: finalize(PACKAGE_POINTER), source });

  for (const doc of scope === "" ? scoped : own) {
    const globs = scopeOf(doc).length === 0 ? [`${scope}/**`] : globsOf(doc);
    const nested = scope === "" ? doc.file : `${scope}/${doc.file}`;
    if (hosts.includes("claude")) {
      out.set(`.claude/rules/${nested}`, {
        text: finalize(`---\n${emitYaml([["paths", globs]])}---\n${doc.body}`),
        source: doc.rel,
      });
    }
    if (hosts.includes("antigravity")) {
      out.set(`.agents/rules/${nested}`, {
        text: finalize(
          `---\n${emitYaml([
            ["trigger", "glob"],
            ["globs", globs.join(",")],
          ])}---\n${doc.body}`,
        ),
        source: doc.rel,
      });
    }
  }
  return out;
}
