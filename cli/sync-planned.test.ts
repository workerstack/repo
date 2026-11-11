import { expect, it } from "vitest";
import { planSync } from "./sync.ts";
import type { Generator, Output, SyncContext } from "./sync/outputs.ts";

const file = (filePath: string, content: string): Output => ({
  kind: "file",
  path: filePath,
  content,
  tracked: true,
  managed: "whole",
});
const ctx = {
  root: "/r",
  read: (rel: string) => (rel === "a.md" ? "disk\n" : null),
} as unknown /* a stub that holds the two fields the planner reads */ as SyncContext;
const reader: Generator = (view) => ({ outputs: [file("b.md", view.read("a.md") ?? "none")], errors: [] });

it("a generator reads the text an earlier one planned, not the file on disk", () => {
  const writer: Generator = () => ({
    outputs: [
      { kind: "link", path: "./a.md", target: "x", tracked: false, managed: "whole" },
      file("./a.md", "planned\n"),
    ],
    errors: [],
  });
  expect(planSync(ctx, [writer, reader], []).outputs.at(-1)).toStrictEqual(file("b.md", "planned\n"));
});

it("a generator reads the disk when nothing earlier planned the path", () => {
  expect(planSync(ctx, [reader], []).outputs).toStrictEqual([file("b.md", "disk\n")]);
});
