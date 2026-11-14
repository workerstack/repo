import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

import { CONFIG_FILE } from "../config.constants.ts";
import { removeTemps } from "./remove-temps.ts";

/** What a refused config loads as: `message` under the config file's name. */
export type Refusal = { errors: string[]; ok: false };

/** Per test file: temp repos made by `repo`, removed after each test, and the refusal a bad config loads as. */
export function useBodyRepo(label: string): { repo: (body: string) => string; refusal: (message: string) => Refusal } {
  const temps: string[] = [];
  afterEach(() => {
    removeTemps(temps.splice(0));
  });
  return {
    refusal: (message) => ({ errors: [`${CONFIG_FILE}: ${message}`], ok: false }),
    repo: (body) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `repo-config-${label}-`));
      temps.push(root);
      fs.writeFileSync(path.join(root, CONFIG_FILE), `export default ${body}\n`);
      return root;
    },
  };
}
