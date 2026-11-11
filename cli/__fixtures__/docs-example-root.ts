import { blocksOf, type ExampleRoot } from "../docs-examples.ts";

/** An example root for `root`: package `@ws/a` at the top, unbuilt, with `extra` laid over it. */
export function ctx(root: string, extra: Partial<ExampleRoot> = {}): ExampleRoot {
  return {
    build: false,
    dir: "",
    name: "@ws/a",
    root,
    ...extra,
  };
}

/** The example blocks of a `references/auth.md` made of a heading and `fences`. */
export function doc(...fences: string[]) {
  return blocksOf("", "references/auth.md", ["# Auth", ...fences].join("\n"));
}
