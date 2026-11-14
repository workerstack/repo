import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";
import { removeTemps } from "./remove-temps.ts";

/** Per test file: a maker of temp dirs holding `files` (path → content), removed after each test; named from `prefix`. */
export function useTempTree(prefix: string): (files: Record<string, string>) => string {
  const dirs: string[] = [];
  afterEach(() => {
    removeTemps(dirs.splice(0));
  });
  return (files) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(root);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    return root;
  };
}
