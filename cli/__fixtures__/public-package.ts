import { AGENT_DEFAULTS } from "../agent-defaults.constants.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { checkPublic } from "../check-public.ts";
import type { ResolvedConfig } from "../config.ts";
import type { ResolvedOwner } from "../owner-config.ts";
import { readWorkspace } from "../sync/workspace.ts";
import { BASE_CONFIG } from "./base-config.ts";
import { removeTemps } from "./remove-temps.ts";

const temps: string[] = [];
afterEach(() => {
  removeTemps(temps.splice(0));
});

export const OWNER: ResolvedOwner = { name: "Lovro Žagar", github: "lovrozagar" };
export const MIT: string = `MIT License

Copyright (c) 2026 ${OWNER.name}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

export const EXPORTS: Record<string, unknown> = {
  ".": { types: "./a.d.ts", default: "./a.js" },
  "./package.json": "./package.json",
};

export const COMPLETE: Record<string, unknown> = {
  name: "@acme/pkg",
  version: "1.0.0",
  private: false,
  description: "A package",
  keywords: ["acme"],
  license: "MIT",
  author: OWNER.name,
  repository: { type: "git", url: "git+https://github.com/acme/pkg.git" },
  homepage: "https://github.com/acme/pkg",
  bugs: { url: "https://github.com/acme/pkg/issues" },
  type: "module",
  engines: { bun: ">=1.4.4" },
  exports: EXPORTS,
  files: ["a.js"],
  publishConfig: { access: "public" },
};

const config = (over: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
  ...BASE_CONFIG,
  packs: ["release"],
  agents: { ...AGENT_DEFAULTS, hosts: [], skills: [] },
  owner: OWNER,
  ...over,
});

/** Writes `manifest` and `license` into a temp root and returns checkPublic's lines. */
export function lines(
  manifest: Record<string, unknown>,
  license: string | null = MIT,
  over: Partial<ResolvedConfig> = {},
): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-public-"));
  temps.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
  if (license !== null) fs.writeFileSync(path.join(root, "LICENSE"), license);
  const read = readWorkspace(root);
  if (!read.ok) throw new Error(read.errors.join("\n"));
  return checkPublic(root, read.workspace, config(over));
}

export const without = (key: string): Record<string, unknown> => {
  const { [key]: _, ...rest } = COMPLETE;
  return rest;
};
