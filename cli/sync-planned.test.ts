import { expect, it } from "vitest";

import { planSync } from "./sync-outputs.ts";
import { context } from "./sync/__fixtures__/context-kit.ts";
import type { Generator, Output, SyncContext } from "./sync/outputs.ts";

function file(filePath: string, content: string): Output {
  return {
    content,
    kind: "file",
    managed: "whole",
    path: filePath,
    tracked: true,
  };
}

const ctx = context({ files: { "a.md": "disk\n" } });

function reader(view: SyncContext): ReturnType<Generator> {
  return { errors: [], outputs: [file("b.md", view.read("a.md") ?? "none")] };
}

function writer(): ReturnType<Generator> {
  return {
    errors: [],
    outputs: [
      { kind: "link", managed: "whole", path: "./a.md", target: "x", tracked: false },
      file("./a.md", "planned\n"),
    ],
  };
}

it("a generator reads the text an earlier one planned, not the file on disk", () => {
  expect(planSync(ctx, [writer, reader], []).outputs.at(-1)).toStrictEqual(file("b.md", "planned\n"));
});

it("a generator reads the disk when nothing earlier planned the path", () => {
  expect(planSync(ctx, [reader], []).outputs).toStrictEqual([file("b.md", "disk\n")]);
});
