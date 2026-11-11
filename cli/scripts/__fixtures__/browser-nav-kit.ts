/** A session test's starting point: fake engines on a fresh bin, already navigated to example.com. */
import path from "node:path";

import { expect } from "vitest";

import { run, tmp, writeFake } from "./browser-kit.ts";

/** A fresh dir with a fake of each of `engines` on its bin, navigated to example.com. */
export async function navigated(prefix: string, engines: readonly string[]): Promise<{ bin: string; cwd: string }> {
  const cwd = tmp(prefix);
  const bin = path.join(cwd, "bin");
  for (const name of engines) writeFake(bin, name);
  const nav = await run(cwd, ["nav", "https://example.com/"], bin);
  expect(nav.code).toBe(0);
  return { bin, cwd };
}
