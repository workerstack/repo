import {
  DENIED_STATUSES,
  GH_AUTH_EXIT,
  GH_TIMEOUT_MS,
  HTTP_STATUS,
  CI_SKIP,
  INSTALL_HINT,
  MS_PER_SECOND,
  LOGIN_HINT,
  RETRY_HINT,
} from "./github.constants.ts";

/** One GitHub API request: `path` is relative to the API root, `body` is sent as JSON. */
export type GhCall = { method: "GET" | "POST" | "PUT" | "PATCH"; path: string; body?: unknown };

/**
 * Why a call did not succeed; `message` reads as a sentence about gh, and `status` is the HTTP status when GitHub
 * answered.
 */
export type GhFailure = {
  ok: false;
  kind: "timeout" | "missing" | "auth" | "http" | "other";
  status?: number;
  message: string;
};

export type GhResult = { ok: true; stdout: string } | GhFailure;

/** The one place GitHub is reached through; tests inject a fake that answers from a settings store. */
export type Gh = (call: GhCall) => Promise<GhResult>;

type Options = { command?: readonly string[]; timeoutMs?: number };

function failureOf(code: number, stderr: string): GhFailure {
  const first = stderr.trim().split("\n")[0];
  const message = first === undefined || first === "" ? `gh exited with ${code}` : first;
  const status = HTTP_STATUS.exec(stderr)?.[1];

  if (code === GH_AUTH_EXIT) return { kind: "auth", message: "gh is not logged in (gh auth status)", ok: false };

  if (status !== undefined) return { kind: "http", message, ok: false, status: Number(status) };

  return { kind: "other", message, ok: false };
}

/**
 * A `Gh` that runs `gh api`, giving every call its own timeout. A timeout kills the child, so a hung gh costs one
 * call's budget; a gh that cannot start is "missing". `command` replaces `gh` in tests.
 */
export function ghRunner({ command = ["gh"], timeoutMs = GH_TIMEOUT_MS }: Options = {}): Gh {
  return async ({ method, path, body }) => {
    const verb = method === "GET" ? [] : ["-X", method];
    const input = body === undefined ? [] : ["--input", "-"];
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      const stdin = body === undefined ? "ignore" : new Blob([JSON.stringify(body)]);

      const child = Bun.spawn([...command, "api", ...verb, path, ...input], {
        signal,
        stderr: "pipe",
        stdin,
        stdout: "pipe",
      });

      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      if (signal.aborted) throw signal.reason;

      return code === 0 ? { ok: true, stdout } : failureOf(code, stderr);
    } catch (error) {
      if (signal.aborted)
        return { kind: "timeout", message: `gh did not answer within ${timeoutMs / MS_PER_SECOND}s`, ok: false };

      return { kind: "missing", message: `gh is not installed (${String(error)})`, ok: false };
    }
  };
}

/** The sentence after `skipped, ` when `repo check` cannot read the settings. */
export function skipReason(failure: GhFailure): string {
  const denied = failure.status !== undefined && DENIED_STATUSES.includes(failure.status);

  return denied ? CI_SKIP : failure.message;
}

const HINTS: Record<GhFailure["kind"], string> = {
  auth: LOGIN_HINT,
  http: LOGIN_HINT,
  missing: INSTALL_HINT,
  other: RETRY_HINT,
  timeout: RETRY_HINT,
};

/**
 * The refusal `repo github` prints when a call fails: what failed on `slug` and what to do; `verb` is what it was
 * doing.
 */
export function applyFailure(slug: string, failure: GhFailure, verb: "change" | "read"): string {
  const why = failure.kind === "auth" ? "not logged in" : failure.message;
  const cause = failure.status === undefined ? why : `HTTP ${failure.status}`;

  return `gh cannot ${verb} ${slug}'s settings (${cause}): ${HINTS[failure.kind]}`;
}
