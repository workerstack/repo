import path from "node:path";

import { extraH2Sections } from "./agents-text.ts";
import { isDir, present } from "./migrate-fs.ts";
import {
  COPIED_DIR,
  LESSONS_INDEX,
  MD,
  OLD_GENERATED_REFS,
  OVERRIDES,
  REFERENCES_DIR,
  REPLACES,
  REPO_DIR,
} from "./migrate.constants.ts";
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
    content,
    kind: "write",
    note: `moved your sections ${titlesOf(missing)} of ${from} to ${to}`,
    path: to,
  });
}

/** `.rulesync/reference` follows the old init's rules; a consumer file goes to `references/` and extra sections too. */
export function planReferences(state: MigrationState): void {
  const dir = `${COPIED_DIR}/reference`;
  const names = state.names(dir).filter((name) => !OLD_GENERATED_REFS.has(name));
  function stockNamed(name: string) {
    return name.endsWith(MD) && present(path.join(state.stock, REFERENCES_DIR, name));
  }
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

/** Lessons move whole; their index is generated, so it stays behind for sync to rewrite. */
export function planLessons(state: MigrationState): void {
  const from = `${COPIED_DIR}/lessons`;
  const names = state.names(from).filter((name) => name !== LESSONS_INDEX);
  if (names.length === 0) return;
  const to = `${REPO_DIR}/lessons`;
  state.move(from, to, { except: [LESSONS_INDEX], note: `moved ${from}/ (${names.length}) to ${to}/` });
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
