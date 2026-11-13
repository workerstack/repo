import { describe, expect, it } from "vitest";

import { context } from "../__fixtures__/release-context.ts";
import { release } from "./release.ts";

const DRAFT_GUARD = "    if: github.event.pull_request.draft != true\n";

function ci(): string {
  const manifest = { name: "pkg", private: false, scripts: { "test:e2e": "vitest" } };
  const output = release(context(["release"], manifest)).outputs[0];

  return output?.kind === "file" ? output.content : "";
}

function job(text: string, name: string): string {
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);

  const next = text.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);

  return text.slice(start, next === -1 ? undefined : start + 1 + next);
}

describe("ci draft pull requests", () => {
  it("runs the pull_request trigger on ready_for_review too", () => {
    expect(ci()).toContain(
      "  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\n  workflow_dispatch:",
    );
  });

  it("skips the test and e2e jobs while the pull request is a draft", () => {
    for (const name of ["test", "e2e"]) expect(job(ci(), name)).toContain(DRAFT_GUARD);
  });

  it("leaves the commits, skips, coverage and consumer jobs unguarded", () => {
    for (const name of ["commits", "skips", "consumer"]) expect(job(ci(), name)).not.toContain(DRAFT_GUARD);
  });
});
