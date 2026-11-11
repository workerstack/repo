import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { formatFiles, updateIo } from "./update-io.ts";

it("formats files and reports the tool's code and output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-update-io-"));
  try {
    fs.writeFileSync(path.join(root, "a.json"), '{"b":1,"a":2}');
    const result = formatFiles(root, ["a.json"]);
    expect(typeof result.code).toBe("number");
    expect(typeof result.output).toBe("string");
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

it("stands on the process: its directory, its fetch and the formatter", () => {
  const io = updateIo();
  expect(io.cwd).toBe(process.cwd());
  expect(io.fetch).toBe(globalThis.fetch);
  expect(io.format).toBe(formatFiles);
});
