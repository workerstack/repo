/**
 * Rewrites of where a write or a patch lands: any checkout's `.repo/<ignored dir>` goes to the root's, stray scratch to
 * `.repo/scratch`.
 */
import path from "node:path";

import { isString } from "../json.ts";
import { IGNORED_DIRS, REPO, SCRATCH, STATE, repoPath, routesToRoot } from "../repo-dirs.ts";
import type { GateCall, GuardResult } from "./gate-call.ts";
import { WRITE_PATH_FIELDS } from "./gate-harness.ts";
import { isUnder, relInside } from "./gate-paths.ts";
import { recordWrote } from "./gate-wrote.ts";
import {
  PATCH_ADD,
  PATCH_DELETE,
  PATCH_HEREDOC_RE,
  PATCH_MOVE,
  PATCH_PATH_RE,
  SCRATCH_ROOT_RE,
} from "./gate.constants.ts";
import { persistOwner } from "./persist-tmp.ts";
import { resolveTyped, type Roots } from "./workspace-root.ts";

/** A `.repo/<ignored dir>` segment pair in a path of either separator; group 1 is the text before `.repo`. */
function ignoredMarker(): RegExp {
  return new RegExp(`(^|[\\\\/])${REPO.replace(".", "\\.")}[\\\\/](?:${IGNORED_DIRS.join("|")})(?:[\\\\/]|$)`);
}

/** The scratch dir a root keeps, `<root>/.repo/scratch`. */
function scratchDir(roots: Roots): string {
  return repoPath(roots.root, SCRATCH);
}

/**
 * A Write into any checkout's `.repo/<ignored dir>/` (a nested subdir or a worktree) goes to the same path under the
 * root's `.repo`, except each checkout's own state (`routesToRoot`). Committed `.repo` files stay.
 * Relative paths resolve against the hook cwd. Null when it is already the root's, stays, or is not such a path.
 */
export function rewriteScratchPath(
  filePath: string | null | undefined,
  roots: Roots | null | undefined,
  p: typeof path = path,
): string | null {
  if (filePath == null || filePath === "" || roots == null) return null;
  const absIn = resolveTyped(roots, filePath, p);
  const inRoot = isUnder(roots.root, absIn, p);
  // Inside the root, look below it, so a root that itself sits under some `.repo/<dir>` is not matched.
  const text = inRoot ? p.relative(roots.root, absIn) : absIn;
  const marker = ignoredMarker().exec(text);

  if (marker === null) return null;
  const prefix = text.slice(0, marker.index);
  const base = inRoot ? p.join(roots.root, prefix) : prefix;
  const below = text.slice(marker.index + (marker[1] /* group 1 always participates in a match */ as string).length);

  return rootDest({ absIn, base, below, root: roots.root }, p);
}

type RootDestInput = { absIn: string; base: string; below: string; root: string };

/** Where the `.repo/<ignored dir>` path `below` of checkout `base` lands under the root, null when it stays. */
function rootDest({ absIn, base, below, root }: RootDestInput, p: typeof path): string | null {
  const rel = relInside(p.join(base, REPO), p.join(base, below), p);

  if (rel === null || !rel.includes("/") || !routesToRoot(base, absIn, p)) return null;
  const dest = p.resolve(root, REPO, ...rel.split("/"));

  return dest === absIn || relInside(p.join(root, REPO), dest, p) === null ? null : dest;
}

/** `<scratch>/<rest>` for the segments left after a stray `tmp/` prefix, null when that leaves the scratch. */
function scratchBelow(rest: string[], scratch: string, p: typeof path): string | null {
  const dest = p.resolve(scratch, ...rest);

  return relInside(scratch, dest, p) === null ? null : dest;
}

/**
 * Writes into another checkout's `.repo/<ignored dir>`, stray scratch names and `tmp/` dirs at the checkout top land
 * in the root's `.repo`. Product files at the top (README.md, `src/`, `cli/`) match no rule and stay where they are.
 */
export function rewriteScratchWrite(
  filePath: string,
  roots: Roots | null | undefined,
  p: typeof path = path,
): string | null {
  if (roots == null) return null;
  const existing = rewriteScratchPath(filePath, roots, p);

  if (existing !== null) return existing;
  const rel = relInside(p.resolve(roots.checkout), resolveTyped(roots, filePath, p), p);

  if (rel === null) return null;
  const segs = rel.split("/");
  const scratch = scratchDir(roots);

  if (segs[0] === STATE) return scratchBelow(segs.slice(1), scratch, p);

  return segs.length === 1 && SCRATCH_ROOT_RE.test(rel) ? p.resolve(scratch, rel) : null;
}

/** The patch inside a Codex `apply_patch <<'EOF' … EOF` shell command, else null. */
export function patchOfCommand(command: string | undefined): string | null {
  return PATCH_HEREDOC_RE.exec(command ?? "")?.groups?.patch ?? null;
}

/** True for the headers whose path is a file the patch creates. */
function createsFile(op: string): boolean {
  return op === PATCH_ADD || op === PATCH_MOVE;
}

/** A patch after the scratch rewrite: its new text (null when nothing moved) and every final path. */
export type PatchRewrite = { patch: string | null; paths: string[] };

/**
 * Add and Move headers whose path is scratch get the root scratch path, the same rule a Write gets.
 * Update and Delete headers stay, since they act on a file that exists where it is.
 * Returns the rewritten patch (null when nothing moved) and every final path.
 */
export function rewritePatch(patch: string, roots: Roots, p: typeof path = path): PatchRewrite {
  const paths: string[] = [];
  const moved: string[] = [];

  const next = patch.replace(PATCH_PATH_RE, (line: string, op: string, target: string) => {
    const dest = createsFile(op) ? rewriteScratchWrite(target, roots, p) : null;

    if (op !== PATCH_DELETE) paths.push(dest ?? resolveTyped(roots, target, p));

    if (dest === null) return line;
    moved.push(dest);

    return `*** ${op}: ${dest}`;
  });

  return { patch: moved.length > 0 ? next : null, paths };
}

/** Every file a write or patch lands on, in the roots' spelling, after the scratch rewrite has moved what it moves. */
export function writeTargets({
  tool,
  input,
  patch,
  roots,
}: Pick<GateCall, "tool" | "input" | "patch" | "roots">): string[] {
  if (tool.kind === "write") {
    const typed = WRITE_PATH_FIELDS.map((k) => input[k]);

    return typed.flatMap((v) =>
      isString(v) && v !== "" ? [rewriteScratchWrite(v, roots) ?? resolveTyped(roots, v)] : [],
    );
  }

  // Every caller that is not a write holds a patch, and both groups of PATCH_PATH_RE always participate in a match.
  return [...String(patch).matchAll(PATCH_PATH_RE)].map(([, op, target]) => {
    const file = String(target);

    return (createsFile(String(op)) ? rewriteScratchWrite(file, roots) : null) ?? resolveTyped(roots, file);
  });
}

/** Where a write field lands when the gate moves it: null when it stays or orchestrate-parent persists it itself. */
function movedPath(call: GateCall, current: string, dest: string): string | null {
  const { tool, roots } = call;

  // orchestrate-parent redirects the same `.repo` path, persists it, and answers the Write itself.
  const isPersisted =
    tool.persistShared === true &&
    dest === rewriteScratchPath(current, roots) &&
    persistOwner(dest, roots.root) !== null;

  return isPersisted ? null : dest;
}

/** What one write field is recorded as, and where it moves to (null to stay). */
function fieldPlan(call: GateCall, current: string) {
  const dest = rewriteScratchWrite(current, call.roots);

  return { moved: dest === null ? null : movedPath(call, current, dest), recorded: dest ?? current };
}

/** Records the files a session wrote, when the call has a session. */
function recordAll({ roots, sid }: GateCall, paths: readonly string[]): void {
  if (sid !== "") for (const p of paths) recordWrote(roots, sid, p);
}

/**
 * A write rewrites its stray scratch paths and records what it wrote; the answer is always its own (null when none
 * moved).
 */
export function writeGuard(call: GateCall): GuardResult {
  if (call.tool.kind !== "write") return undefined;
  const next = { ...call.input };
  const wrote: string[] = [];
  let isChanged = false;

  for (const key of WRITE_PATH_FIELDS) {
    const current = next[key];

    if (!isString(current) || current === "") continue;
    const { recorded, moved } = fieldPlan(call, current);
    wrote.push(recorded);

    if (moved === null) continue;
    next[key] = moved;
    isChanged = true;
  }

  recordAll(call, wrote);

  return isChanged ? { type: "rewrite", updatedInput: next } : null;
}

/**
 * A patch rewrites its scratch headers and records what it wrote; the answer is always its own (null when none
 * moved).
 */
export function patchGuard(call: GateCall): GuardResult {
  const { patch, roots, input, text, field } = call;

  if (patch === null || patch === "") return undefined;
  const out = rewritePatch(patch, roots);
  recordAll(call, out.paths);
  const rewritten = out.patch;

  if (rewritten === null) return null;

  return { type: "rewrite", updatedInput: { ...input, [field]: text.replace(patch, () => rewritten) } };
}
