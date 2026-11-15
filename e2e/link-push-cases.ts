/** The link-push suite's cases, in one sandbox: git's own commits and ref moves drive the generated hook. */
import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import type { GetSandbox } from "./get-sandbox.types";
import { ROOT_VARS } from "./hosts-kit";
import { commitAll, installed, PUSHED, setVersion } from "./link-push-kit";

/** The hooks path is set and the consumer's copy is the linked 1.0.0. */
export function startCase(get: GetSandbox) {
  it("starts with the hooks path set and the copy at 1.0.0", async () => {
    const sb = get();
    const config = await sb.git("config", "core.hooksPath");
    expect(config.stdout).toBe(".githooks\n");
    expect(installed(sb)).toBe("1.0.0");
  });
}

/** A commit on main repacks the consumer's copy; a commit on another branch does not. */
export function commitCases(get: GetSandbox) {
  it("a commit on main updates the consumer's installed copy and prints what it pushed", async () => {
    const sb = get();
    setVersion(sb, "1.0.1");
    const r = await commitAll(sb, "feat: one");
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).toContain(PUSHED);
    expect(installed(sb)).toBe("1.0.1");
  });

  it("a commit on another branch pushes nothing", async () => {
    const sb = get();
    await sb.git("checkout", "-q", "-b", "other");
    setVersion(sb, "1.0.2");
    const r = await commitAll(sb, "feat: two");
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).not.toContain("repo link:");
    expect(installed(sb)).toBe("1.0.1");
  });
}

/** Moving main while it is not out warns. */
export function moveCase(get: GetSandbox) {
  it("moving main while another branch is out warns and pushes nothing", async () => {
    const sb = get();
    const r = await sb.run("git", ["fetch", "-q", ".", "other:refs/heads/main"], { env: ROOT_VARS });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("repo link: warning");
    expect(r.stderr + r.stdout).not.toContain(PUSHED);
    expect(installed(sb)).toBe("1.0.1");
  });
}

/** A checkout with no bin never fails git. */
export function noBinCase(get: GetSandbox) {
  it("with no bin installed, a prepared run exits 0 and a ref update still succeeds", async () => {
    const sb = get();
    const bare = path.join(sb.root, "nobin");
    fs.mkdirSync(path.join(bare, ".repo", "tmp", "dependents"), { recursive: true });
    const hook = path.join(bare, "hook");
    fs.writeFileSync(hook, sb.read(".githooks/reference-transaction"));
    sb.expectOk(await sb.run("git", ["-C", bare, "init", "-q", "-b", "main"], { env: ROOT_VARS }));
    const direct = await sb.run("sh", ["-c", `cd '${bare}' && sh '${hook}' prepared </dev/null`], { env: ROOT_VARS });
    expect(direct.status).toBe(0);
    expect(direct.stderr).toBe("");
    const hooks = path.join(sb.repo, ".githooks");

    const args = [
      "-C",
      bare,
      "-c",
      `core.hooksPath=${hooks}`,
      "commit",
      "-q",
      "--allow-empty",
      "--no-verify",
      "-m",
      "x",
    ];

    const commit = await sb.run("git", args, { env: ROOT_VARS });
    expect(commit.status).toBe(0);
    expect(commit.stderr).toContain("run bun install");
    sb.expectOk(await sb.run("git", ["-C", bare, "rev-parse", "--verify", "main"], { env: ROOT_VARS }));
  });
}
