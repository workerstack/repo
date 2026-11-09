/**
 * Rule outputs. A pathless rule folds into `AGENTS.md`, which every host reads. A rule with `paths` is written where
 * the host scopes it: `.claude/rules/` with a `paths:` list for claude and `.agents/rules/` with a glob trigger for
 * antigravity. Codex, grok and cursor cannot scope, so when any of them is on, `AGENTS.md` ends with a
 * `## Rules by path` list that points at each path rule's source file. `description` and `overrides` never render.
 */
import type { Host } from "../../config.ts";
import { PACKAGE_NAME } from "../stock.ts";
import { emitYaml, finalize } from "./frontmatter.ts";
import type { Doc, Sources } from "./sources.ts";

/** Hosts that read only `AGENTS.md` and so need the path rules listed there. */
const UNSCOPED_HOSTS: readonly Host[] = ["codex", "grok", "cursor"];

/** The globs a rule applies to; none when it has no `paths` or they cover every file. */
export function scopeOf(doc: Doc): string[] {
  const paths = (doc.data["paths"] as string[] | undefined) ?? [];
  return paths.length === 1 && (paths[0] === "**/*" || paths[0] === "*") ? [] : paths;
}

/** Where a reader finds the rule's source from the repo root: stock lives in the installed package. */
const sourcePath = (doc: Doc) => (doc.rel.startsWith(".repo/") ? doc.rel : `node_modules/${PACKAGE_NAME}/${doc.rel}`);

/** POSIX path to file text for the rules of `sources`, given the hosts that are on. */
export function renderRules(sources: Sources, hosts: readonly Host[]): Map<string, string> {
  const out = new Map<string, string>();
  if (hosts.length === 0) return out;

  const pathless = sources.rules.filter((doc) => scopeOf(doc).length === 0);
  const scoped = sources.rules.filter((doc) => scopeOf(doc).length > 0);
  const sections = pathless.map((doc) => doc.body.trim()).filter((body) => body !== "");
  if (scoped.length > 0 && hosts.some((host) => UNSCOPED_HOSTS.includes(host))) {
    const lines = scoped.map((doc) => `- \`${scopeOf(doc).join(" ")}\`: read \`${sourcePath(doc)}\``);
    sections.push(`## Rules by path\n${lines.join("\n")}`);
  }
  out.set("AGENTS.md", finalize(sections.join("\n\n")));

  for (const doc of scoped) {
    const globs = scopeOf(doc);
    if (hosts.includes("claude")) {
      out.set(`.claude/rules/${doc.file}`, finalize(`---\n${emitYaml([["paths", globs]])}---\n${doc.body}`));
    }
    if (hosts.includes("antigravity")) {
      out.set(`.agents/rules/${doc.file}`, finalize(`---\n${emitYaml([["trigger", "glob"], ["globs", globs.join(",")]])}---\n${doc.body}`));
    }
  }
  return out;
}
