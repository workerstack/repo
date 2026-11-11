/** A workspace with one saved lesson matching `src/a.ts`, for the plan suites that check lesson citations. */
import fs from "node:fs";
import path from "node:path";

import { persistLesson } from "../lessons-ops.ts";
import { VALID_LESSON, savedOk } from "./persist-bodies.ts";

/** Writes `src/a.ts` and the saved `plan-forks` lesson that matches it into `ws`. */
export function seedLesson(ws: string): void {
  fs.mkdirSync(path.join(ws, "src"), { recursive: true });
  fs.writeFileSync(path.join(ws, "src/a.ts"), "x\n");
  const file = path.join(ws, ".repo/lessons/plan-forks.md");
  const r = persistLesson({ content: VALID_LESSON, filePath: file, workspaceRoot: ws });
  fs.writeFileSync(file, savedOk(r).content);
}
