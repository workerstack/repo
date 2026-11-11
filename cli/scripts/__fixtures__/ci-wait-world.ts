import { waitMain, type Runner } from "../ci-wait.ts";
import { recordPath, recordSchema, type RecordFs } from "../ci-wait-record.ts";

export const SHA = "b3f5e8a0123456789abcdef0123456789abcdef0";
export const ok = (stdout = ""): { code: number; stdout: string; stderr: string } => ({ code: 0, stdout, stderr: "" });
export const bad = (stderr = ""): { code: number; stdout: string; stderr: string } => ({ code: 1, stdout: "", stderr });
export const run = (databaseId: number, createdAt: string, headBranch = "main") => ({ databaseId, createdAt, headBranch });
export const job = (name: string, conclusion: string) => ({ name, conclusion });

export type World = Record<string, ReturnType<typeof ok> | ReturnType<typeof ok>[]>;
export const GIT: World = {
  "rev-parse HEAD": ok(`${SHA}\n`),
  [`branch -r --contains ${SHA}`]: ok("  origin/main\n"),
  "rev-parse --abbrev-ref HEAD": ok("main\n"),
  "rev-parse --abbrev-ref origin/HEAD": ok("origin/main\n"),
  "rev-parse --path-format=absolute --git-common-dir": ok("/main/" + ".git\n"),
};
export const LIST = "run list --commit";
export const BRANCH_LIST = "run list --branch main";

/** A runner that answers by the args joined; an array answers one call after another and repeats its last. */
export function answerer(name: string, table: World, calls: string[]): Runner {
  return (args) => {
    const key = args.join(" ");
    calls.push(`${name} ${key}`);
    const value = Object.entries(table).find(([prefix]) => key === prefix || key.startsWith(`${prefix} `))?.[1];
    if (Array.isArray(value)) return value.length > 1 ? (value.shift() ?? bad()) : (value[0] ?? bad());
    return value ?? bad(`no answer for ${key}`);
  };
}

/** An fs that keeps what is written and renamed in memory. */
function memoryFs(files: Map<string, string>): RecordFs {
  return {
    mkdirSync: () => undefined,
    writeFileSync: (file: unknown, data: unknown) => void files.set(String(file), String(data)),
    renameSync: (from: unknown, to: unknown) => {
      files.set(String(to), files.get(String(from)) ?? "");
      files.delete(String(from));
    },
    rmSync: () => undefined,
  } as unknown /* only the four methods a record calls are given */ as RecordFs;
}

export async function world(git: World, gh: World, branch?: string) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  let clock = 0;
  const out: string[] = [];
  const err: string[] = [];
  const code = await waitMain({
    cwd: "/repo",
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    git: answerer("git", git, calls),
    gh: answerer("gh", gh, calls),
    fs: memoryFs(files),
    branch,
  });
  const record = (sha: string) => {
    const text = files.get(recordPath("/main", sha));
    return text === undefined ? undefined : recordSchema().parse(JSON.parse(text));
  };
  return { code, out: out.join(""), err: err.join(""), calls, clock, files, record };
}

export const GH: World = {
  "auth status": ok(),
  [`${LIST} ${SHA}`]: ok(JSON.stringify([run(123, "2026-11-09T10:00:00Z")])),
};
export const view = (conclusion: string, jobs: ReturnType<typeof job>[], status = "completed") =>
  ok(JSON.stringify({ status, conclusion, jobs }));

