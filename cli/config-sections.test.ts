import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.ts";
import { refusal, repo, useConfigKit } from "./fixtures/config-kit.ts";

useConfigKit();

describe("owner", () => {
  it("resolves to the name and github login, and is left out when omitted", async () => {
    const owner = { github: "lovrozagar", name: "Lovro Žagar" };
    const given = await loadConfig(repo(`export default { owner: ${JSON.stringify(owner)} }\n`));
    expect(given).toMatchObject({ config: { owner }, ok: true });
    const omitted = await loadConfig(repo("export default {}\n"));
    expect(omitted.ok && omitted.config.owner).toBeUndefined();
  });

  it("refuses an owner without a github login, and an unknown key", async () => {
    expect(await loadConfig(repo('export default { owner: { name: "A" } }\n'))).toStrictEqual(
      refusal("owner.github: must be a GitHub login like lovrozagar"),
    );
    const extra = 'export default { owner: { name: "A", github: "a", email: "x" } }\n';
    expect(await loadConfig(repo(extra))).toStrictEqual(refusal('owner: unknown key "email"'));
    expect(await loadConfig(repo('export default { owner: { name: "", github: "a" } }\n'))).toStrictEqual(
      refusal("owner.name: must be the owner's name, like Lovro Žagar"),
    );
  });
});

const DEPLOY = { cache: false, dependsOn: ["^build"] };
const tasks = (body: string) => `export default { packs: ["workspace"], turbo: { tasks: ${body} } }\n`;

it("turbo.tasks: parses tasks under the workspace pack", async () => {
  const loaded = await loadConfig(repo(tasks(JSON.stringify({ deploy: DEPLOY }))));
  expect(loaded).toMatchObject({ config: { turbo: { tasks: { deploy: DEPLOY } } }, ok: true });
});

it("turbo.tasks: resolves an empty turbo section to no tasks, and an omitted one to none", async () => {
  const empty = await loadConfig(repo('export default { packs: ["workspace"], turbo: {} }\n'));
  expect(empty).toMatchObject({ config: { turbo: { tasks: {} } }, ok: true });
  const omitted = await loadConfig(repo('export default { packs: ["workspace"] }\n'));
  expect(omitted).toMatchObject({ config: { turbo: undefined }, ok: true });
});

it.each(["typecheck", "test"])("turbo.tasks: refuses a task named %s", async (name) => {
  const loaded = await loadConfig(repo(tasks(JSON.stringify({ [name]: {} }))));
  expect(loaded).toStrictEqual(refusal(`turbo.tasks "${name}" is generated; pick another name`));
});

it("turbo.tasks: names every generated task it finds", async () => {
  const loaded = await loadConfig(repo(tasks("{ typecheck: {}, test: {}, ok: {} }")));
  expect(loaded).toStrictEqual(
    refusal(
      'turbo.tasks "typecheck" is generated; pick another name',
      'turbo.tasks "test" is generated; pick another name',
    ),
  );
});

it("turbo.tasks: refuses turbo without the workspace pack", async () => {
  const loaded = await loadConfig(repo('export default { packs: ["docs"], turbo: {} }\n'));
  expect(loaded).toStrictEqual(
    refusal('turbo: set only with the workspace pack; add "workspace" to packs or delete turbo'),
  );
});

it("turbo.tasks: refuses an unknown task key, a bad flag, a bad list and a turbo that is not an object", async () => {
  expect(await loadConfig(repo(tasks("{ a: { nope: 1 } }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("{ a: { cache: 1 } }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("{ a: { env: [1] } }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("{ a: 1 }")))).toMatchObject({ ok: false });
  expect(await loadConfig(repo('export default { packs: ["workspace"], turbo: 1 }\n'))).toMatchObject({ ok: false });
  expect(await loadConfig(repo(tasks("1")))).toMatchObject({ ok: false });
});

it("link: parses a package-to-checkout map, and leaves it out when omitted", async () => {
  const map = { "@workerstack/flare": "../flare-wt" };
  const loaded = await loadConfig(repo(`export default { link: ${JSON.stringify(map)} }\n`));
  expect(loaded).toMatchObject({ config: { link: map }, ok: true });
  const omitted = await loadConfig(repo("export default {}\n"));
  expect(omitted).toMatchObject({ config: { link: undefined }, ok: true });
});

it("link: refuses a value that is not a path", async () => {
  const loaded = await loadConfig(repo('export default { link: { "@workerstack/flare": 1 } }\n'));
  expect(loaded).toStrictEqual(
    refusal("link.@workerstack/flare: must be a path like ../flare, relative to the repo root"),
  );
  expect(await loadConfig(repo("export default { link: [] }\n"))).toStrictEqual(
    refusal('link: must be an object like { "@workerstack/flare": "../flare" }'),
  );
});

it("clean: parses the extra build dir names, and leaves the section out when omitted", async () => {
  const loaded = await loadConfig(repo('export default { clean: { build: [".flare"] } }\n'));
  expect(loaded).toMatchObject({ config: { clean: { build: [".flare"] } }, ok: true });
  expect(await loadConfig(repo("export default { clean: {} }\n"))).toMatchObject({ config: { clean: {} }, ok: true });
  expect(await loadConfig(repo("export default {}\n"))).toMatchObject({ config: { clean: undefined }, ok: true });
});

it("clean: refuses a name that is a path, a list that is not names, and a section that is not an object", async () => {
  const name = 'clean.build[0]: must be a dir name like ".flare", not a path';
  expect(await loadConfig(repo('export default { clean: { build: ["a/b"] } }\n'))).toStrictEqual(refusal(name));
  expect(await loadConfig(repo("export default { clean: { build: 1 } }\n"))).toStrictEqual(
    refusal('clean.build: must be a list of dir names like [".flare"]'),
  );
  expect(await loadConfig(repo("export default { clean: [] }\n"))).toStrictEqual(
    refusal('clean: must be an object like { build: [".flare"] }'),
  );
});

it("ci.checks: parses named argv arrays, and defaults to none", async () => {
  const checks = { "product-tree": ["bun", "scripts/check/product-tree.ts"] };
  const loaded = await loadConfig(repo(`export default { ci: { checks: ${JSON.stringify(checks)} } }\n`));
  expect(loaded).toMatchObject({ config: { ci: { checks } }, ok: true });
  expect(await loadConfig(repo("export default {}\n"))).toMatchObject({ config: { ci: { checks: {} } }, ok: true });
  expect(await loadConfig(repo("export default { ci: {} }\n"))).toMatchObject({
    config: { ci: { checks: {} } },
    ok: true,
  });
});

it("ci.checks: refuses an empty argv, a built-in label and an unknown key, each naming the fix", async () => {
  expect(await loadConfig(repo("export default { ci: { checks: { a: [] } } }\n"))).toStrictEqual(
    refusal('ci.checks.a: must be a non-empty list of strings like ["bun", "scripts/check.ts"]'),
  );
  expect(await loadConfig(repo('export default { ci: { checks: { fmt: ["x"] } } }\n'))).toStrictEqual(
    refusal('ci.checks: "fmt" is a built-in gate label; pick another name'),
  );
  expect(await loadConfig(repo("export default { ci: { nope: 1 } }\n"))).toStrictEqual(
    refusal('ci: unknown key "nope"'),
  );
});
