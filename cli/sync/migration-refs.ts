import path from "node:path";
import { extraH2Sections, extractUserMarkdown } from "./agents-text.ts";
import {
  AGENTS_MD,
  COPIED_DIR,
  LESSONS_INDEX,
  MD,
  OLD_GENERATED_REFS,
  OVERRIDES,
  REFERENCES_DIR,
  REPLACES,
  REPO_DIR,
  RULE_FRONTMATTER,
} from "./migrate.constants.ts";
import { isDir, present } from "./migrate-fs.ts";
import { h1Of, titlesOf } from "./migration-docs.ts";
import type { MigrationState } from "./migration-state.ts";

/** The sections of a consumer file under a stock name that the file at `to` lacks, written there. */
function carrySections(state: MigrationState, from: string, stockText: string): void {
  const to = `${REFERENCES_DIR}/${path.posix.basename(from)}`;
  const extras = extraH2Sections(state.text(from), stockText);
  if (extras === "") {
    state.move(from, to, { note: `moved your edited ${from} to ${to}` });
    return;
  }
  const existing = state.read(to);
  const missing = existing === null ? extras : extraH2Sections(extras, existing);
  if (missing === "") return;
  const content =
    existing === null
      ? `${h1Of(stockText) ?? h1Of(state.text(from)) ?? `# ${path.posix.basename(from)}`}\n\n${missing}\n`
      : `${existing.trimEnd()}\n\n${missing}\n`;
  state.steps.push({
    kind: "write",
    path: to,
    content,
    note: `moved your sections ${titlesOf(missing)} of ${from} to ${to}`,
  });
}

/** `.rulesync/reference` follows the old init's rules; a consumer file goes to `references/` and extra sections too. */
export function planReferences(state: MigrationState): void {
  const dir = `${COPIED_DIR}/reference`;
  const names = state.names(dir).filter((name) => !OLD_GENERATED_REFS.has(name));
  const stockNamed = (name: string) => name.endsWith(MD) && present(path.join(state.stock, REFERENCES_DIR, name));
  for (const name of [...names.filter(stockNamed), ...names.filter((n) => !stockNamed(n))]) {
    const from = `${dir}/${name}`;
    const to = `${REFERENCES_DIR}/${name}`;
    const stockText = state.stockText(to);
    // a file is a past or current stock copy under either of its names: where older inits put it, or where it lives now
    if (!isDir(path.join(state.root, from)) && state.unedited([from, to], state.text(from), stockText)) continue;
    if (!stockNamed(name) || stockText === null) state.move(from, to, { note: `moved ${from} to ${to}` });
    else carrySections(state, from, stockText);
  }
}

/** AGENTS.md text outside the guarded block becomes the `agents` rule, which every host reads. */
export function planAgentsText(state: MigrationState): void {
  const text = state.read(AGENTS_MD);
  const own =
    text === null || state.unedited(AGENTS_MD, text, state.stockText(AGENTS_MD))
      ? ""
      : extractUserMarkdown(text).trim();
  if (own === "") return;
  const to = `${REPO_DIR}/rules/agents.md`;
  state.write(AGENTS_MD, to, { content: `${RULE_FRONTMATTER}${own}\n`, note: `moved your AGENTS.md text to ${to}` });
  // The text now lives in the rule; the stale file must not be there to be adopted again.
  state.drop.push(AGENTS_MD);
}

/** Lessons move whole; their index is generated, so it stays behind for sync to rewrite. */
export function planLessons(state: MigrationState): void {
  const from = `${COPIED_DIR}/lessons`;
  const names = state.names(from).filter((name) => name !== LESSONS_INDEX);
  if (names.length === 0) return;
  const to = `${REPO_DIR}/lessons`;
  state.move(from, to, { note: `moved ${from}/ (${names.length}) to ${to}/`, except: [LESSONS_INDEX] });
}

/** Hooks, MCP policy, permissions and global settings that differ from stock move to the same path under `.repo/`. */
export function planOverrides(state: MigrationState): void {
  for (const [file, tail] of OVERRIDES) {
    const from = `${COPIED_DIR}/${file}`;
    const to = `${REPO_DIR}/${file}`;
    if (state.differs(from, state.stockText(from)))
      state.move(from, to, { note: `moved your ${from} to ${to}${tail}` });
  }
  for (const name of state.names(`${COPIED_DIR}/global-settings`)) {
    const from = `${COPIED_DIR}/global-settings/${name}`;
    const stockText = state.stockText(from);
    if (!isDir(path.join(state.root, from)) && !state.differs(from, stockText)) continue;
    const to = `${REPO_DIR}/global-settings/${name}`;
    state.move(from, to, { note: `moved your ${from} to ${to}${stockText === null ? "" : REPLACES}` });
  }
}
