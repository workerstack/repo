/** A prompt, where it came from, and the skill (or `none`) the model should name; a control is its near miss. */
export type RoutingCase = {
  id: string;
  source: string;
  input: string;
  expect: string;
  control?: boolean;
};

export const cases: RoutingCase[] = [
  {
    expect: "handoff",
    id: "handoff-new-session",
    input: "give me handoff to run in new session",
    source: "transcript 2026-11-08",
  },
  {
    control: true,
    expect: "pickup",
    id: "handoff-new-session-control",
    input: "pick up the handoff in this new session",
    source: "control of handoff-new-session",
  },
  {
    expect: "handoff",
    id: "handoff-next-point",
    input: "Once next logical point done handoff so we continue in new session",
    source: "transcript 2026-11-09",
  },
  {
    control: true,
    expect: "away",
    id: "handoff-next-point-control",
    input: "I am away and will not answer, keep going and decide without asking",
    source: "control of handoff-next-point",
  },
  {
    expect: "su",
    id: "status-left",
    input: "status update whats left to do and how much longer",
    source: "transcript 2026-11-10",
  },
  {
    control: true,
    expect: "backlog",
    id: "status-left-control",
    input: "list the backlog of things we found but did not do",
    source: "control of status-left",
  },
  { expect: "su", id: "status-woke-up", input: "i woke up, how we doing", source: "transcript 2026-11-09" },
  {
    control: true,
    expect: "pickup",
    id: "status-woke-up-control",
    input: "i woke up, pick up the handoff and continue",
    source: "control of status-woke-up",
  },
  { expect: "su", id: "status-waiting", input: "what are we waiting for", source: "transcript 2026-11-13" },
  {
    control: true,
    expect: "show-me",
    id: "status-waiting-control",
    input: "show me what the backlog command would print",
    source: "control of status-waiting",
  },
  {
    expect: "show-me",
    id: "show-before-after",
    input: "show me how it will look like",
    source: "transcript 2026-11-12",
  },
  {
    control: true,
    expect: "bro",
    id: "show-before-after-control",
    input: "say that again in plain words, no jargon",
    source: "control of show-before-after",
  },
  { expect: "bro", id: "plain-words", input: "i have no idea what u said", source: "transcript 2026-11-12" },
  {
    control: true,
    expect: "explain",
    id: "plain-words-control",
    input: "explain in more detail what you just did",
    source: "control of plain-words",
  },
  { expect: "do", id: "do-no-plan", input: "fix all of it right now, no plan", source: "transcript 2026-11-08" },
  {
    control: true,
    expect: "write-plan-deep",
    id: "do-no-plan-control",
    input: "write a plan to fix all of it",
    source: "control of do-no-plan",
  },
  { expect: "do", id: "do-remove-worktree", input: "remove the worktree", source: "transcript 2026-11-08" },
  {
    control: true,
    expect: "write-plan-fast",
    id: "do-remove-worktree-control",
    input: "write a short fast plan to remove the worktree",
    source: "control of do-remove-worktree",
  },
  {
    expect: "write-plan-deep",
    id: "plan-open-issues",
    input: "write a plan for these **3 open issues**",
    source: "transcript 2026-11-12",
  },
  {
    control: true,
    expect: "write-plan-fast",
    id: "plan-open-issues-control",
    input: "write a short fast plan for these 3 open issues",
    source: "control of plan-open-issues",
  },
  { expect: "none", id: "go-on-stopped", input: "why did u stop. go", source: "transcript 2026-11-13" },
  {
    control: true,
    expect: "su",
    id: "go-on-stopped-control",
    input: "why did u stop. what is left to do",
    source: "control of go-on-stopped",
  },
  {
    expect: "none",
    id: "go-on-ignore",
    input: "that session now stopped, ignore it continue",
    source: "transcript 2026-11-10",
  },
  {
    control: true,
    expect: "pickup",
    id: "go-on-ignore-control",
    input: "that session stopped, continue from its handoff",
    source: "control of go-on-ignore",
  },
];
