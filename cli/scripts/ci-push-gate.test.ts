import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { A, B, C, D, WIN, cleanRigs, rig, row } from "./__fixtures__/push-gate-rig.ts";
import { recordPush } from "./ci-push-gate.ts";

afterEach(cleanRigs);

const forms: [string, string, string][] = [
  ["git push", "main", A],
  ["git push origin main", "main", A],
  ["git push -u origin x", "x", C],
  ["git push origin HEAD:refs/heads/x", "x", A],
  ["git push origin HEAD", "main", A],
  ["git push --force-with-lease origin +main", "main", A],
  ["CI=1 git push", "main", A],
  ["git -c push.default=current push", "main", A],
  ["bun repo lint && git push origin main && bun repo ci wait", "main", A],
  ["git status; git push", "main", A],
];

it.each(forms)("notes the push in %s", (command, branch, sha) => {
  const r = rig();
  r.note(command);
  expect(r.pushed()).toStrictEqual(row(branch, sha));
});

it("resolves the branch and the commit in the directory -C names", () => {
  const r = rig();
  const other = path.resolve(r.main, "..", "other");
  r.world.tips[other] = { branch: "feat", sha: B };
  r.note(`git -C ${path.relative(r.main, other)} push`);
  expect(r.pushed()).toStrictEqual(row("feat", B));
});

it("resolves the directory a cd names", () => {
  const r = rig();
  r.world.tips[path.join(r.main, "sub")] = { branch: "feat", sha: B };
  r.note('cd "sub" && git push');
  expect(r.pushed()).toStrictEqual(row("feat", B));
});

it.each([`git -C "${WIN}" push`, `cd ${WIN} && git push`, `cd "${WIN}" && echo hi && git push`])(
  "resolves the Windows directory in %s",
  (command) => {
    const r = rig();
    r.note(command);
    expect(r.pushed()).toStrictEqual(row("feat", B));
  },
);

it("resolves a relative -C from a Windows working directory", () => {
  const r = rig();
  r.world.tips["C:\\work\\other"] = { branch: "feat", sha: D };
  r.note("git -C ..\\other push", WIN);
  expect(r.pushed()).toStrictEqual(row("feat", D));
});

it("notes one push per refspec, after the pushes already noted", () => {
  const r = rig();
  r.note("git push origin main x");
  r.note("git push origin x");
  expect(r.pushed().map((p) => p.branch)).toStrictEqual(["main", "x", "x"]);
});

it("keeps each session's pushes apart", () => {
  const r = rig();
  r.note("git push", r.main, "s1");
  expect(r.pushed("s2")).toStrictEqual([]);
});

it("notes a worktree's push under the main checkout", () => {
  const r = rig();
  const tree = path.join(r.main, ".worktrees", "w");
  r.world.tips[tree] = { branch: "feat", sha: B };
  r.note("git push", tree);
  expect(r.pushed()).toStrictEqual(row("feat", B));
});

it("ignores a delete, a tag, a detached HEAD and an unknown ref", () => {
  const r = rig();
  r.world.tips[r.main] = { branch: "HEAD", sha: A };
  for (const c of ["push origin :gone", "push origin HEAD:refs/tags/v1", "push origin HEAD", "push origin ghost"])
    r.note(`git ${c}`);

  expect(r.pushed()).toStrictEqual([]);
});

it("notes a push past an option it does not use and an empty chain segment", () => {
  const r = rig();
  r.note("git --no-pager push; ");
  r.note("; git push");
  expect(r.pushed().map((p) => p.sha)).toStrictEqual([A, A]);
});

it("looks up only the main checkout for no session or a command that is not a push", () => {
  const r = rig();
  r.note("git push", r.main, "");
  for (const c of ["git status", "ls && echo push", "cd sub", "git -C push", "git -C", "git", ""]) r.note(c);
  expect(r.asked.filter((a) => !a.includes("--git-common-dir"))).toStrictEqual([]);
  expect(r.pushed()).toStrictEqual([]);
});

it("keeps the commit as it was before the command and marks the push pending", () => {
  const r = rig();
  r.note("git push");
  expect(r.raw()).toStrictEqual([{ ...row("main", A)[0], dir: r.main, pending: true, src: "HEAD" }]);
});

it("takes the new commit when it landed, as in commit && push, on the next tool call", () => {
  const r = rig();
  r.note("git commit -am x && git push");
  r.world.tips[r.main] = { branch: "main", sha: B };
  r.note("ls");
  expect(r.raw()).toStrictEqual(row("main", B));
});

it("keeps the old commit when the new one did not land, as in push && commit", () => {
  const r = rig({ landed: { main: [A] } });
  r.note("git push && git commit -am x");
  r.world.tips[r.main] = { branch: "main", sha: B };
  r.note("ls");
  expect(r.raw()).toStrictEqual(row("main", A));
});

it("keeps the old commit when the directory is gone, and settles the push at the Stop", () => {
  const r = rig();
  r.note("git push");
  delete r.world.tips[r.main];
  expect(r.gate()).toContain(`you pushed ${A.slice(0, 7)}`);
  expect(r.raw()).toStrictEqual(row("main", A));
});

it("writes the file back only when a push was pending", () => {
  const r = rig();
  const writes: string[] = [];
  const spy = {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      writes.push(String(args[0]));
      fs.writeFileSync(...args);
    },
  };
  const deps = { ...r.deps, fs: spy };
  for (const command of ["git push", "ls", "git push", "ls", "ls"])
    recordPush({ command, cwd: r.main, session: "s1" }, deps);
  expect(writes).toHaveLength(4);
});

it("never throws when the file cannot be written, and writes nothing", () => {
  const r = rig();
  const deny = {
    ...fs,
    writeFileSync: () => {
      throw new Error("disk full");
    },
  };
  const input = { command: "git push", cwd: r.main, session: "s1" };
  expect(() => recordPush(input, { ...r.deps, fs: deny })).not.toThrow();
  expect(r.pushed()).toStrictEqual([]);
});

it("starts over when the file holds something else", () => {
  const r = rig();
  fs.mkdirSync(path.join(r.main, ".tmp/repo/sessions/s1"), { recursive: true });
  fs.writeFileSync(path.join(r.main, ".tmp/repo/sessions/s1/pushed.json"), "junk");
  r.note("git push");
  expect(r.pushed()).toStrictEqual(row("main", A));
});
