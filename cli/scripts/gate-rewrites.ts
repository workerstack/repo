/** Rewrites of where a write or a patch lands: stray scratch goes under the root's `.tmp/repo`. */
import path from "node:path";

import type { GateCall, GuardResult } from "./gate-call.ts";
import { WRITE_PATH_FIELDS } from "./gate-harness.ts";
import { isUnder, relInside } from "./gate-paths.ts";
import { recordWrote } from "./gate-wrote.ts";
import {
  DOT_TMP_DEPTH,
  DOT_TMP_DIR,
  PATCH_ADD,
  PATCH_DELETE,
  PATCH_HEREDOC_RE,
  PATCH_MOVE,
  PATCH_PATH_RE,
  REPO_DIR,
  SCRATCH_MARKER,
  SCRATCH_ROOT_RE,
  TMP_DIR,
} from "./gate.constants.ts";
import { persistOwner } from "./persist-tmp.ts";
import { resolveTyped, type Roots } from "./workspace-root.ts";

/** The scratch dir a root keeps, `<root>/.tmp/repo`. */
function scratchDir(roots: Roots, p: typeof path): string {
  return p.resolve(roots.root, DOT_TMP_DIR, REPO_DIR);
}

/** The path below a `.tmp/repo/` marker as a safe relative posix path, or null when there is none or it climbs. */
function scratchRel(posix: string, p: typeof path): string | null {
  const marker = SCRATCH_MARKER.exec(posix);
  const rel = marker === null ? "" : posix.slice(marker.index + marker[0].length);
  const relNorm = p.posix.normalize(rel);

  return rel === "" || rel.startsWith("/") || relNorm === "." || rel.split("/").includes("..") ? null : relNorm;
}

/**
 * A Write aimed at any `.tmp/repo/` other than the root's goes to `<root>/.tmp/repo/<rest>`.
 * Relative paths resolve against the hook cwd. Null when it is already root scratch or not scratch.
 */
export function rewriteScratchPath(
  filePath: string | null | undefined,
  roots: Roots | null | undefined,
  p: typeof path = path,
): string | null {
  if (filePath == null || filePath === "" || roots == null) return null;
  const raw = filePath;
  const destRoot = scratchDir(roots, p);
  const absIn = resolveTyped(roots, raw, p);

  if (isUnder(destRoot, absIn, p)) return null;
  // Inside the root, look below it, so a root that itself sits under some `.tmp/repo` is not matched.
  const posix = (isUnder(roots.root, absIn, p) ? p.relative(roots.root, absIn) : raw).replaceAll("\\", "/");
  const relNorm = scratchRel(posix, p);

  if (relNorm === null) return null;
  const dest = p.resolve(destRoot, relNorm);

  return relInside(destRoot, dest, p) === null ? null : dest;
}

/**
 * `<scratch>/<rest>` for the segments left after a `tmp/` or `.tmp/<name>/` prefix, null when that leaves the
 * scratch.
 */
function scratchBelow(rest: string[], scratch: string, p: typeof path): string | null {
  const dest = p.resolve(scratch, ...rest);

  return relInside(scratch, dest, p) === null ? null : dest;
}

/** The segments below a `tmp/` or `.tmp/<name>/` prefix, or null when the path has neither. */
function strayDirRest(segs: string[]): string[] | null {
  const [first, second] = segs;

  if (first === TMP_DIR) return segs.slice(1);

  return first === DOT_TMP_DIR && second !== REPO_DIR ? segs.slice(DOT_TMP_DEPTH) : null;
}

/**
 * Stray scratch names and `tmp/` dirs at the checkout top go under the root's `.tmp/repo`. Product files at the top
 * (README.md, `src/`, `cli/`) match neither rule and stay where they are.
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
  const scratch = scratchDir(roots, p);
  const rest = strayDirRest(segs);

  if (rest !== null) return scratchBelow(rest, scratch, p);

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
      typeof v === "string" && v !== "" ? [rewriteScratchWrite(v, roots) ?? resolveTyped(roots, v)] : [],
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

  // orchestrate-parent redirects the same `.tmp/repo` path, persists it, and answers the Write itself.
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

    if (typeof current !== "string" || current === "") continue;
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
