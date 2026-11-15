/** Fake steps and a runner for the gate-run tests: steps named for their pass keys, and a log of what each saw. */
import type { Gate } from "../gate-run.ts";
import { gateMain } from "../turn.ts";
import { passed, type Step, type StepResult, type Turn } from "../turn-steps.ts";

/** What the fake steps did, in order: `<name> <changed files>` at each start. */
export const log: string[] = [];

/** A step named `name`, so its pass key is its own; it logs its start and the files it gates, then runs `body`. */
export function step(name: string, body: (turn: Turn) => Promise<StepResult | null> | StepResult | null = () => passed(`${name} ok`)): Step {
  const run = async (turn: Turn) => {
    log.push(`${name} ${turn.changes.map((change) => change.rel).join(" ")}`);

    return await body(turn);
  };

  Object.defineProperty(run, "name", { value: name });

  return run;
}

/** A promise and the function that settles it. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

/** `promise`, or a rejection naming `what` when it does not settle within a second. */
export async function within(promise: Promise<void>, what: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} never happened`)), 1000);
  });

  try {
    await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A turn gate over the tree with `parts` as its steps; the rest empty. */
export function gateOf(parts: Partial<Pick<Gate, "fixes" | "writes" | "beside" | "after">>, name: Gate["name"] = "turn"): Gate {
  const scope = name === "turn" ? { kind: "tree" as const } : { kind: "staged" as const };

  return { after: [], beside: [], fixes: [], name, parse: () => ({ ok: true, scope }), writes: [], ...parts };
}

/** `gate` run in `root`: its exit code, its summary line and what it printed to stderr, and the log it left. */
export async function runGate(gate: Gate, root: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await gateMain(gate, [], { cwd: root, stderr: (s) => err.push(s), stdout: (s) => out.push(s) });

  return { code, err, log: log.splice(0), out: out.join("") };
}
