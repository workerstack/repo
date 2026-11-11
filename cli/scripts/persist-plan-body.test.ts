import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { VALID_PLAN } from "./fixtures/persist-bodies.ts";
import { validatePlan } from "./persist-plan-validate.ts";
import { persistPlan } from "./persist-plan.ts";

useTempDirs();

function tmpWs(): string {
  return tempDir("persist-plan-rules-");
}

// A plan the saver accepted, as a validator input: mutate its text and read the errors back.
function saved() {
  const r = persistPlan({ content: VALID_PLAN, created: "2026-08-26T14:30:00Z", workspaceRoot: tmpWs() });
  if (!r.ok) throw new Error(r.error);
  return { filename: r.filename, text: r.content };
}

function errorsFor(edit: (text: string) => string, opts?: { fresh?: boolean }) {
  const { filename, text } = saved();
  return validatePlan(filename, edit(text), opts);
}

describe("validatePlan section rules", () => {
  it("denies sections out of order and a section outside the six", () => {
    expect(errorsFor((t) => t.replace("## Constraints\n", "## Notes\n"))).toContain("heading order");
    expect(errorsFor((t) => t.replace("## Verify", "## Appendix\nx\n\n## Verify"))).toContain("extra h2");
  });

  it("denies a Goal that is empty or longer than three sentences", () => {
    const goal = /## Goal\n[\s\S]*?\n\n## Usage/;
    expect(errorsFor((t) => t.replace(goal, "## Goal\nOne. Two. Three. Four.\n\n## Usage"))).toContain("goal");
    expect(errorsFor((t) => t.replace(goal, "## Goal\n\n## Usage"))).toContain("goal");
  });

  it("denies an empty section and one without bullets", () => {
    expect(errorsFor((t) => t.replace("- Plans live under .tmp/repo/plans/\n", "plain prose\n"))).toContain(
      "Context bullets",
    );
    expect(errorsFor((t) => t.replace("- Do not clobber other .gitignore lines\n", ""))).toContain("Constraints empty");
  });
});

describe("validatePlan step and log rules", () => {
  it("denies a checked box on a fresh plan only", () => {
    const check = (t: string) => t.replace("1.1 [ ]", "1.1 [x]");
    expect(errorsFor(check)).toContain("fresh [x]");
    expect(errorsFor(check, { fresh: false })).not.toContain("fresh [x]");
  });

  it("denies a phase with no leaf and a last phase that is neither Verify nor the final number", () => {
    expect(errorsFor((t) => t.replace("\n## Previous mistakes", "3 [ ] lonely\n\n## Previous mistakes"))).toContain(
      "phase 3 leaf",
    );
    const errors = errorsFor((t) =>
      t.replace("\n## Previous mistakes", "9 [ ] other\n9.1 [ ] step\n\n## Previous mistakes"),
    );
    expect(errors).toContain("verify last phase");
  });

  it("denies an empty Previous mistakes section", () => {
    expect(errorsFor((t) => t.replace(/## Previous mistakes\n\(none\)\n/, "## Previous mistakes\n"))).toContain(
      "## Previous mistakes is empty; write (none)",
    );
  });
});
