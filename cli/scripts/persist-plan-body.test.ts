import { describe, expect, it } from "vitest";

import { usePlanRules } from "./__fixtures__/persist-plan-rules-kit.ts";

const { errorsFor } = usePlanRules();

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
    expect(errorsFor((t) => t.replace("- Plans live under .repo/plans/\n", "plain prose\n"))).toContain(
      "Context bullets",
    );
    expect(errorsFor((t) => t.replace("- Do not clobber other .gitignore lines\n", ""))).toContain("Constraints empty");
  });
});

function check(t: string) {
  return t.replace("1.1 [ ]", "1.1 [x]");
}

describe("validatePlan step and log rules", () => {
  it("denies a checked box on a fresh plan only", () => {
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
