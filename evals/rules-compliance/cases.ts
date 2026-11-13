/** The first step an agent in the main checkout should take; `edit` is never right, so no case expects it. */
type Step = "plan" | "worktree" | "answer";

/** A prompt, where it came from, and the first step it should get; a control is its near miss one step down. */
export type RulesCase = {
  id: string;
  source: string;
  input: string;
  expect: Step;
  control?: boolean;
};

export const cases: RulesCase[] = [
  {
    expect: "plan",
    id: "plan-lessons-too-long",
    input: "our lessons get too fat. need enforcement and sanitization, shortest possible with the remaining value",
    source: "transcript 2026-11-13",
  },
  {
    control: true,
    expect: "worktree",
    id: "plan-lessons-too-long-control",
    input: "fix the typo sanizitzation in the lessons index heading",
    source: "control of plan-lessons-too-long",
  },
  {
    expect: "plan",
    id: "plan-away-session-wide",
    input:
      "make sure that when the away skill is used everything knows it and never blocks, " +
      "fast and non fast, session wide",
    source: "transcript 2026-11-12",
  },
  {
    control: true,
    expect: "worktree",
    id: "plan-away-session-wide-control",
    input: "just do it: add the words session wide to the end of the away skill description",
    source: "control of plan-away-session-wide",
  },
  {
    expect: "plan",
    id: "plan-plan-and-roadmap",
    input: "do it, write plan and roadmap",
    source: "transcript 2026-11-12",
  },
  {
    control: true,
    expect: "worktree",
    id: "plan-plan-and-roadmap-control",
    input: "do it, rename the Format heading in the roadmap format page to Layout",
    source: "control of plan-plan-and-roadmap",
  },
  {
    expect: "plan",
    id: "plan-enforce-no-local-ci",
    input: "agents run ci locally, that is what github is for. help me enforce this asap",
    source: "transcript 2026-11-13",
  },
  {
    control: true,
    expect: "worktree",
    id: "plan-enforce-no-local-ci-control",
    input: "just fix the one line lint says is too wide in cli/scripts/eval.ts",
    source: "control of plan-enforce-no-local-ci",
  },
  {
    expect: "worktree",
    id: "worktree-fix-now-no-plan",
    input: "lint lists errors in cli/scripts/eval.ts and cli/eval/run.ts. fix all of it right now, no plan",
    source: "transcript 2026-11-08, context added",
  },
  {
    control: true,
    expect: "answer",
    id: "worktree-fix-now-no-plan-control",
    input:
      "lint lists errors in cli/scripts/eval.ts and cli/eval/run.ts. what is left to fix? do not change anything yet",
    source: "control of worktree-fix-now-no-plan",
  },
  {
    expect: "plan",
    id: "plan-clean-after-move",
    input:
      "we moved the eval cache to .repo/tmp/evals; repo clean, its tests and the docs still name the old path. " +
      "also make sure repo clean is updated to work after the move correctly",
    source: "transcript 2026-11-12, context added",
  },
  {
    control: true,
    expect: "worktree",
    id: "plan-clean-after-move-control",
    input:
      "we moved the eval cache to .repo/tmp/evals; repo clean, its tests and the docs still name the old path. " +
      "just fix the comment at the top of cli/eval/cache.ts that still names the old path",
    source: "control of plan-clean-after-move",
  },
  {
    expect: "plan",
    id: "plan-make-default",
    input: "we agreed repo eval should run on the session by default. good, just make it the default, should be easy",
    source: "transcript 2026-11-10, context added",
  },
  {
    control: true,
    expect: "worktree",
    id: "plan-make-default-control",
    input:
      "we agreed repo eval should run on the session by default. " +
      "just fix the typo sesion in the --via line of references/exports.md",
    source: "control of plan-make-default",
  },
  {
    expect: "worktree",
    id: "worktree-just-document-it",
    input: "wherever is better, just document it",
    source: "transcript 2026-11-08",
  },
  {
    control: true,
    expect: "answer",
    id: "worktree-just-document-it-control",
    input: "where is this documented?",
    source: "control of worktree-just-document-it",
  },
];
