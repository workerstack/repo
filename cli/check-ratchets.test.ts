import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ratchetProblems } from "./check-ratchets.ts";
import { git, removePlanted, repoOnMain, tempDir, write } from "./fixtures/planted-repo.ts";

afterEach(removePlanted);

const FLOORS = "coverage-floors.json";
const FAILURES = "known-failures.json";
const BASELINE = ".repo/lint-baseline.json";
const HIGH = 61;
const LOW = 58;

const floor = (branches: number) => ({ statements: 80, branches, functions: 90 });
const job = "cli/scripts/job.ts";

describe("ratchetProblems, floors", () => {
  const main = { [FLOORS]: { [job]: floor(HIGH) }, [job]: "export {};\n" };

  it("fails a lowered floor", () => {
    const dir = repoOnMain(main);
    write(dir, { [FLOORS]: { [job]: floor(LOW) } });
    expect(ratchetProblems(dir)).toEqual([
      `${FLOORS}: ${job} branches ${LOW} is below main's ${HIGH}; floors only rise`,
    ]);
  });

  it("passes an unchanged or raised floor", () => {
    const dir = repoOnMain(main);
    write(dir, { [FLOORS]: { [job]: floor(HIGH + 1) } });
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("fails a floor dropped while its source exists, and passes one dropped with its source", () => {
    const dir = repoOnMain(main);
    write(dir, { [FLOORS]: {} });
    expect(ratchetProblems(dir)).toEqual([
      `${FLOORS}: ${job} has no floor but main has one and the file exists; restore it`,
    ]);
    fs.rmSync(path.join(dir, job));
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("passes a new file at any floor", () => {
    const dir = repoOnMain(main);
    write(dir, { [FLOORS]: { [job]: floor(HIGH), "cli/new.ts": floor(1) } });
    expect(ratchetProblems(dir)).toEqual([]);
  });
});

describe("ratchetProblems, Rust floors", () => {
  const lib = "a/src/lib.rs";
  const rust = (lines: number) => ({ lines, functions: 66, regions: 58 });
  const main = { [FLOORS]: { [lib]: rust(80) }, [lib]: "" };

  it("fails a .rs row below main's and passes a raised one", () => {
    const dir = repoOnMain(main);
    write(dir, { [FLOORS]: { [lib]: rust(66) } });
    expect(ratchetProblems(dir)).toEqual([`${FLOORS}: ${lib} lines 66 is below main's 80; floors only rise`]);
    write(dir, { [FLOORS]: { [lib]: rust(81) } });
    expect(ratchetProblems(dir)).toEqual([]);
  });
});

describe("ratchetProblems, renamed floors", () => {
  const main = { [FLOORS]: { [job]: floor(HIGH) }, [job]: "export {};\n" };

  it("fails a renamed file whose new key is below the old key's floor", () => {
    const dir = repoOnMain(main);
    git(dir, "mv", job, "cli/scripts/work.ts");
    write(dir, { [FLOORS]: { "cli/scripts/work.ts": floor(LOW) } });
    expect(ratchetProblems(dir)).toEqual([
      `${FLOORS}: cli/scripts/work.ts branches ${LOW} is below main's ${HIGH} (renamed from ${job}); floors only rise`,
    ]);
  });

  it("passes a renamed file that carries its floor", () => {
    const dir = repoOnMain(main);
    git(dir, "mv", job, "cli/scripts/work.ts");
    write(dir, { [FLOORS]: { "cli/scripts/work.ts": floor(HIGH) } });
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("reads the floors from the path it is given", () => {
    const dir = repoOnMain({ "dev/floors.json": { [job]: floor(HIGH) }, [job]: "" });
    write(dir, { "dev/floors.json": { [job]: floor(LOW) } });
    expect(ratchetProblems(dir, { floors: "dev/floors.json" })).toHaveLength(1);
    expect(ratchetProblems(dir)).toEqual([]);
  });
});

describe("ratchetProblems, the main ref", () => {
  const main = { [FLOORS]: { [job]: floor(HIGH) }, [job]: "" };

  it("still fails a lowered floor when only origin/main exists", () => {
    const origin = repoOnMain(main);
    git(origin, "checkout", "-q", "main");
    const dir = tempDir();
    git(dir, "clone", "-q", origin, dir);
    git(dir, "checkout", "-q", "-b", "feature");
    git(dir, "branch", "-q", "-D", "main");
    write(dir, { [FLOORS]: { [job]: floor(LOW) } });
    expect(ratchetProblems(dir)).toHaveLength(1);
  });
});

describe("ratchetProblems, no main ref", () => {
  it("compares nothing in a repo with no main", () => {
    const dir = tempDir();
    git(dir, "init", "-q", "-b", "work");
    write(dir, { [FLOORS]: { [job]: floor(LOW) }, [FAILURES]: ["a"] });
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "work");
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("compares nothing before the first commit", () => {
    const dir = tempDir();
    git(dir, "init", "-q", "-b", "main");
    write(dir, { [FLOORS]: { [job]: floor(LOW) } });
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("compares nothing for a file main does not have", () => {
    const dir = repoOnMain({ "README.md": "x\n" });
    write(dir, { [FLOORS]: { [job]: floor(LOW) }, [FAILURES]: ["a"], [BASELINE]: { "a.ts": { r: 1 } } });
    expect(ratchetProblems(dir)).toEqual([]);
  });
});

describe("ratchetProblems, known failures", () => {
  const main = { [FAILURES]: ["a.test.ts > one", "a.test.ts > two"] };

  it("fails an entry main's list lacks", () => {
    const dir = repoOnMain(main);
    write(dir, { [FAILURES]: ["a.test.ts > one", "a.test.ts > two", "a.test.ts > three"] });
    expect(ratchetProblems(dir)).toEqual([
      `${FAILURES}: "a.test.ts > three" is not on main's list; fix the case instead of listing it`,
    ]);
  });

  it("fails a swapped entry though the list is no longer", () => {
    const dir = repoOnMain(main);
    write(dir, { [FAILURES]: ["a.test.ts > one", "a.test.ts > other"] });
    expect(ratchetProblems(dir)).toEqual([
      `${FAILURES}: "a.test.ts > other" is not on main's list; fix the case instead of listing it`,
    ]);
  });

  it("passes a shrunk list", () => {
    const dir = repoOnMain(main);
    write(dir, { [FAILURES]: ["a.test.ts > one"] });
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("reads the list from the path it is given", () => {
    const dir = repoOnMain({ "dev/kf.json": ["x"] });
    write(dir, { "dev/kf.json": ["x", "y"] });
    expect(ratchetProblems(dir, { knownFailures: "dev/kf.json" })).toHaveLength(1);
  });
});

describe("ratchetProblems, the lint baseline", () => {
  const MAGIC = "repo(magic-number)";
  const main = { [BASELINE]: { "a.ts": { [MAGIC]: 2 }, "b.ts": { [MAGIC]: 1 } } };

  it("fails a rule whose total rises over main's", () => {
    const dir = repoOnMain(main);
    write(dir, { [BASELINE]: { "a.ts": { [MAGIC]: 3 }, "b.ts": { [MAGIC]: 1 } } });
    expect(ratchetProblems(dir)).toEqual([
      `${BASELINE}: ${MAGIC} totals 4, main has 3; fix the new hit instead of baselining it`,
    ]);
  });

  it("fails a rule that rises in a new file even when another file fell", () => {
    const dir = repoOnMain(main);
    write(dir, { [BASELINE]: { "a.ts": { [MAGIC]: 1 }, "b.ts": { [MAGIC]: 1 }, "c.ts": { [MAGIC]: 2 } } });
    expect(ratchetProblems(dir)).toHaveLength(1);
  });

  it("passes a rename that keeps the per-rule totals", () => {
    const dir = repoOnMain(main);
    write(dir, { [BASELINE]: { "x.ts": { [MAGIC]: 2 }, "b.ts": { [MAGIC]: 1 } } });
    expect(ratchetProblems(dir)).toEqual([]);
  });
});

describe("ratchetProblems, the lint baseline, lowered and seeded", () => {
  const MAGIC = "repo(magic-number)";
  const main = { [BASELINE]: { "a.ts": { [MAGIC]: 2 }, "b.ts": { [MAGIC]: 1 } } };

  it("passes a lowered total", () => {
    const dir = repoOnMain(main);
    write(dir, { [BASELINE]: { "a.ts": { [MAGIC]: 1 } } });
    expect(ratchetProblems(dir)).toEqual([]);
  });

  it("lets a rule main's baseline lacks be seeded", () => {
    const dir = repoOnMain(main);
    write(dir, { [BASELINE]: { "a.ts": { [MAGIC]: 2, "repo(new-rule)": 40 }, "b.ts": { [MAGIC]: 1 } } });
    expect(ratchetProblems(dir)).toEqual([]);
  });
});
