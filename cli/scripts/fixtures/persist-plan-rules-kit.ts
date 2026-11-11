/** The saved plan the plan validator suites mutate, and the fence check plans and roadmaps share. */
import { tempDir, useTempDirs } from "../../sync/fixtures/temp-dirs.ts";
import { persistPlan } from "../persist-plan.ts";
import { validatePlan } from "../persist-plan-validate.ts";
import { VALID_PLAN } from "./persist-bodies.ts";

/** `saved` saves a fresh plan; `errorsFor` validates that plan after `edit`. */
export type PlanRules = {
  saved: () => { filename: string; text: string };
  errorsFor: (edit: (text: string) => string, opts?: { fresh?: boolean }) => string[];
};

/** Registers temp-dir cleanup for the suite and returns its plan helpers. */
export function usePlanRules(): PlanRules {
  useTempDirs();
  // A plan the saver accepted, as a validator input: mutate its text and read the errors back.
  function saved(): { filename: string; text: string } {
    const r = persistPlan({
      content: VALID_PLAN,
      created: "2026-08-26T14:30:00Z",
      workspaceRoot: tempDir("persist-plan-rules-"),
    });
    if (!r.ok) throw new Error(r.error);
    return { filename: r.filename, text: r.content };
  }
  return {
    errorsFor: (edit, opts) => {
      const { filename, text } = saved();
      return validatePlan(filename, edit(text), opts);
    },
    saved,
  };
}

/** Appends a code fence that never closes. */
export function openFence(text: string): string {
  return `${text}\n\`\`\`\nnever closed\n`;
}

/** Whether the unclosed fence is reported and the section rules were skipped. */
export function fenceFirst(errors: string[]): boolean {
  return errors.some((e) => e.startsWith("unclosed code fence at line")) && !errors.includes("heading order");
}
