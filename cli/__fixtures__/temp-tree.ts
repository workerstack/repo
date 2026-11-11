import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

/** Per test file: a maker of temp dirs holding `files` (path → content), removed after each test; named from `prefix`. */
export function useTempTree(prefix: string): (files: Record<string, string>) => string {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { force: true, recursive: true });
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
