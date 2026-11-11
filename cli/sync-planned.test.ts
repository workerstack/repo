import { expect, it } from "vitest";

import { planSync } from "./sync-outputs.ts";
import type { Generator, Output, SyncContext } from "./sync/outputs.ts";

const file = (filePath: string, content: string): Output => ({
  content,
  kind: "file",
  managed: "whole",
  path: filePath,
  tracked: true,
});
const ctx = {
  read: (rel: string) => (rel === "a.md" ? "disk\n" : null),
  root: "/r",
} as unknown /* a stub that holds the two fields the planner reads */ as SyncContext;
const reader: Generator = (view) => ({ errors: [], outputs: [file("b.md", view.read("a.md") ?? "none")] });

it("a generator reads the text an earlier one planned, not the file on disk", () => {
  const writer: Generator = () => ({
    errors: [],
    outputs: [
      { kind: "link", managed: "whole", path: "./a.md", target: "x", tracked: false },
      file("./a.md", "planned\n"),
    ],
  });
  expect(planSync(ctx, [writer, reader], []).outputs.at(-1)).toStrictEqual(file("b.md", "planned\n"));
});

it("a generator reads the disk when nothing earlier planned the path", () => {
  expect(planSync(ctx, [reader], []).outputs).toStrictEqual([file("b.md", "disk\n")]);
});
