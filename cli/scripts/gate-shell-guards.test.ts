import { describe, expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { camelCall, commandOf } from "./__fixtures__/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";

const tmp = useTmp();

function run(command: string) {
  return processFatTools(camelCall("Bash", { command }, { workspaceRoot: tmp.dir("gate-guards-") }));
}

describe("local ci", () => {
  it("denies a whole-ci run in every spelling and points at GitHub", () => {
    for (const command of [
      "bun repo ci",
      "repo ci",
      "bun run ci",
      "npm run ci",
      "bun ./bin/repo.ts ci --no-coverage",
      "rtk bun repo ci",
      "cd x && bun repo ci",
      "bun repo ci; echo done",
    ]) {
      const out = run(command);

      expect(out?.type, command).toBe("deny");
      expect(out?.type === "deny" ? out.reason : "", command).toMatch(/GitHub runs ci/);
    }
  });

  it("lets the ci subcommands and other commands through", () => {
    for (const command of [
      "bun repo ci wait main",
      "bun repo ci skips d",
      "bun repo ci merge d",
      "bun repo cinema",
      "echo hi",
    ])
      expect(run(command)?.type, command).not.toBe("deny");
  });
});

describe("bun test", () => {
  it("runs the test script instead of bun's own runner, alone or in a compound", () => {
    expect(commandOf(run("bun test"))).toBe("bun run test");
    expect(commandOf(run("bun test cli/a.test.ts"))).toBe("bun run test cli/a.test.ts");
    expect(commandOf(run("cd x && bun test a"))).toBe("cd x && bun run test a");
  });

  it("leaves the test script and other bun commands alone", () => {
    expect(run("bun run test a")).toBeNull();
    expect(run("bun testing")).toBeNull();
  });
});
