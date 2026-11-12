/**
 * The head of a plan save: `PLAN_NAME:` and `commit:` lines, the frontmatter a new plan gets, and the one a rewrite
 * keeps.
 */
import { FM_OPEN, NOT_FOUND } from "./persist-doc.constants.ts";
import {
  captured,
  createdLine,
  hasKey,
  injectFrontmatter as injectDoc,
  parseFrontmatter,
  retitled,
  sourceLine,
  stripFrontmatter,
  stripBom,
} from "./persist-doc.ts";
import { extractMode, extractStrategy, stripModeLine, stripStrategyLine } from "./persist-keys.ts";
import { COMMIT_LINE_RE, COMMIT_STRIP_RE, PLAN_NAME_RE } from "./persist-plan.constants.ts";
import { fencedLineSet } from "./persist-sections.ts";

const FM_END_RE = /\n---\n$/;

/** The `PLAN_NAME:` line outside a code fence and above the first `## `, with its index; null when absent. */
function planNameLine(lines: string[]) {
  const { fenced } = fencedLineSet(lines);

  for (const [at, line] of lines.entries()) {
    if (fenced.has(at)) continue;

    if (line.startsWith("## ")) return null;
    const m = PLAN_NAME_RE.exec(line);

    if (m !== null) return { at, name: captured(m, 1) };
  }

  return null;
}

export function extractPlanName(content: string): string {
  return planNameLine(content.split("\n"))?.name ?? "";
}

/** `content` without its `PLAN_NAME:` line and the blank lines after it, wherever it sits above the first `## `. */
export function stripPlanName(content: string): string {
  const lines = content.split("\n");
  const found = planNameLine(lines);

  if (found === null) return lines.join("\n");
  const rest = lines.slice(found.at + 1);
  const blanks = rest.findIndex((l) => l.trim() !== "");
  lines.splice(found.at, 1 + (blanks === NOT_FOUND ? rest.length : blanks));

  return lines.join("\n");
}

export function extractCommit(content: string): string | undefined {
  const text = stripBom(content);

  if (text.startsWith(FM_OPEN)) {
    const fm = parseFrontmatter(text);

    if (fm.error === undefined && hasKey(fm.map, "commit")) return fm.map.commit;
  }

  const m = COMMIT_LINE_RE.exec(text);

  return m === null ? undefined : m[1];
}

export function stripCommitLine(content: string): string {
  return content.replace(COMMIT_STRIP_RE, "");
}

export type FrontmatterInput = {
  serial: number;
  slug: string;
  source?: string;
  body: string;
  created?: string;
  commit?: string | undefined;
  strategy?: string | undefined;
  mode?: string | undefined;
};

export function injectFrontmatter({
  serial,
  slug,
  source,
  body,
  created,
  commit,
  strategy,
  mode,
}: FrontmatterInput): string {
  const optional = [
    commit != null && commit !== "" ? `commit: ${commit}` : "",
    strategy != null && strategy !== "" ? `strategy: ${strategy}` : "",
    // An empty `mode:` is still sent, so validation denies it rather than dropping it.
    mode === undefined ? "" : `mode: ${mode}`,
  ].filter(Boolean);

  const lines = [
    `serial: ${serial}`,
    `name: ${slug}`,
    "status: ready",
    "reviews: 0",
    createdLine(created),
    sourceLine(source),
    ...optional,
  ];

  return injectDoc(lines, slug, stripFrontmatter(body));
}

/** `head` (frontmatter ending in `---\n`) with `key: value` set; unchanged when `value` is undefined. */
function setHeadKey(head: string, key: string, value: string | undefined) {
  if (value === undefined) return head;
  const line = new RegExp(`^${key}:.*$`, "m");

  return line.test(head)
    ? head.replace(line, () => `${key}: ${value}`)
    : head.replace(FM_END_RE, () => `\n${key}: ${value}\n---\n`);
}

/** Body-only revision (PLAN_NAME, no frontmatter): keep the saved frontmatter and slug. */
export function withSavedFrontmatter(previous: string, raw: string): string {
  const fm = parseFrontmatter(previous);

  // Nothing to keep: validation of the bare body names the missing frontmatter.
  if (fm.error !== undefined) return raw;
  const head = previous.slice(0, previous.length - fm.body.length);

  const nextHead = setHeadKey(
    setHeadKey(setHeadKey(head, "commit", extractCommit(raw)), "strategy", extractStrategy(raw)),
    "mode",
    extractMode(raw),
  );

  const rest = retitled(stripModeLine(stripStrategyLine(stripCommitLine(stripPlanName(raw)))), String(fm.map.name));

  return `${nextHead}\n${rest}`;
}
