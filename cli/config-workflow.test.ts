import { expect, it } from "vitest";

import { useBodyRepo } from "./__fixtures__/body-repo.ts";
import { loadConfig } from "./config.ts";
import { WORKFLOWS } from "./workflow.ts";

const { refusal, repo } = useBodyRepo("workflow");

it.each(WORKFLOWS)("resolves workflow: %s", async (workflow) => {
  expect(await loadConfig(repo(`{ workflow: "${workflow}" }`))).toMatchObject({ config: { workflow }, ok: true });
});

it("resolves workflow to worktree when the config omits it", async () => {
  expect(await loadConfig(repo("{}"))).toMatchObject({ config: { workflow: "worktree" }, ok: true });
});

it.each(['"trunk"', "1", "null"])("refuses workflow: %s and names the three", async (value) => {
  expect(await loadConfig(repo(`{ workflow: ${value} }`))).toStrictEqual(
    refusal('workflow: must be "worktree", "pull-request" or "main"'),
  );
});
