import { expect, it, vi } from "vitest";

const fakes = await vi.hoisted(() => import("./fixtures/main-mocks.ts").then((mocks) => mocks.mockedGithubFakes()));
import { usePacks, writeConfigs } from "./fixtures/check-repo.ts";
import { useMainCheckRepo } from "./fixtures/main-check-repo.ts";
import { start } from "./main.ts";

const { repo, written } = useMainCheckRepo(fakes);
vi.setConfig({ testTimeout: 60_000 });

it("with the release pack on, prints the Stryker install and the empty coverage.mutate and exits 1", async () => {
  writeConfigs(repo);
  usePacks(repo, "release");
  await start();
  expect(repo.besidesKnip()).toContain(
    [
      `repo check: the release pack runs mutation tests nightly; \
bun add -d @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1`,
      `repo check: coverage.mutate (src/**/*.ts) matches no tracked file; \
set coverage.mutate in workerstack.config.ts`,
      "",
    ].join("\n"),
  );
  expect(process.exitCode).toBe(1);
});

it("with the release pack and a public root, prints each missing metadata field and exits 1", async () => {
  writeConfigs(repo);
  repo.write("package.json", { author: "workerstack", name: "app", private: false });
  repo.put(
    "workerstack.config.ts",
    'export default { packs: ["release"], owner: { name: "Ann Lee", github: "ann" } };\n',
  );
  await start();
  const printed = repo.besidesKnip();
  expect(printed).toContain(
    'repo check: package.json: "author" is "workerstack"; set it to "Ann Lee", the owner in workerstack.config.ts\n',
  );
  expect(printed).toContain('repo check: package.json: "keywords" is missing; list 1 to 20 GitHub topics\n');
  expect(printed).toContain("repo check: LICENSE is missing; add the MIT license naming Ann Lee\n");
  expect(process.exitCode).toBe(1);
});

it("with the release pack and a public root without an owner, asks for the owner", async () => {
  writeConfigs(repo);
  repo.write("package.json", { name: "app", private: false });
  usePacks(repo, "release");
  await start();
  expect(repo.besidesKnip()).toContain(
    "repo check: workerstack.config.ts: the release pack with a public package needs owner: { name, github }\n",
  );
  expect(process.exitCode).toBe(1);
});

it(
  "with the release pack on, prints actionlint's problem for a workflow to stderr and exits 1",
  { timeout: 180_000 },
  async () => {
    writeConfigs(repo);
    usePacks(repo, "release");
    const job = "  build:\n    runs_on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
    repo.put(".github/workflows/other.yml", `name: x\non: push\njobs:\n${job}`);
    await start();
    const line = 'repo check: actionlint: .github/workflows/other.yml:5:5: unexpected key "runs_on" for "job" section';
    expect(written.err.some((text) => text.startsWith(line) && text.endsWith("[syntax-check]\n"))).toBe(true);
    expect(process.exitCode).toBe(1);
  },
);
