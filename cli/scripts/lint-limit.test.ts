import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { standardsRepo } from "../__fixtures__/standards-repo.ts";
import { useTempDirs } from "../__fixtures__/temp-dirs.ts";
import { captureTool, runTool } from "./lint.ts";

const { tempDir } = useTempDirs("workerstack-lint-limit-");

afterEach(() => vi.restoreAllMocks());

const LIMIT_MS = 300;
const STOPPED = "repo lint: oxlint ran past its 0.3 s limit and was stopped\n";

/** A stand-in for bun that never ends, as a hung oxlint does; its path is no shell word. */
function hungBun(): void {
  const bin = path.join(tempDir(), "hung-bun");
  fs.writeFileSync(bin, "#!/bin/sh\nexec sleep 600\n", { mode: 0o755 });
  vi.spyOn(process, "execPath", "get").mockReturnValue(bin);
}

it.skipIf(process.platform === "win32")("stops a repo lint whose oxlint runs past the limit and names it", async () => {
  const root = standardsRepo(tempDir());
  hungBun();
  const written: string[] = [];
  expect(await runTool("oxlint", [], { cwd: root, limitMs: LIMIT_MS, stderr: (s) => written.push(s) })).toBe(1);
  expect(written.join("")).toBe(STOPPED);
});

it.skipIf(process.platform === "win32")("stops a captured oxlint run past the limit and names it", () => {
  const root = tempDir();
  hungBun();
  expect(captureTool("oxlint", [], { limitMs: LIMIT_MS, root })).toStrictEqual({
    code: 1,
    stderr: STOPPED,
    stdout: "",
  });
});
