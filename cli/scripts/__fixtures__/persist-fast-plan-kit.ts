/** Helpers the fast plan save suites share. */
import fs from "node:fs";

import { prepareFastPlanUpdate } from "../persist-fast-plan.ts";

/** Rewrites a saved fast plan through its update, writing the file when the update passes. */
export function updateFastPlan(ws: string, abs: string, content: string) {
  const r = prepareFastPlanUpdate({ content, filePath: abs, workspaceRoot: ws });

  if (r.ok) fs.writeFileSync(abs, r.content);

  return r;
}
