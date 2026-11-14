import { describe, expect, it } from "vitest";

import { useTmp } from "./__fixtures__/gate-workspace.ts";
import { camelCall, commandOf } from "./__fixtures__/hook-payload.ts";
import { processFatTools } from "./gate-fat-tools.ts";
import { quoteQuery } from "./gate-job.ts";

const tmp = useTmp();

it("rewrites bash dump to job and ls to rtk", () => {
  const ws = tmp.dir("gate-bash-");

  function bash(command: string) {
    return processFatTools(camelCall("Bash", { command }, { workspaceRoot: ws }));
  }

  expect(bash("cat src/a.ts")?.type).toBe("rewrite");
  expect(commandOf(bash("cat src/a.ts"))).toMatch(/node_modules\/\.bin\/repo job --job exec --query /);
  expect(bash("ls src")).toStrictEqual({ type: "rewrite", updatedInput: { command: "rtk ls src" } });
});

it("passes compound bash through untouched", () => {
  const ws = tmp.dir("gate-bash-");

  for (const command of [
    "cd src && cat a.ts",
    "grep -n x a.ts | head",
    "cat > a.md <<'EOF'\n`su` $HOME\nEOF",
    "ls; ls src",
  ])
    expect(processFatTools(camelCall("Bash", { command }, { workspaceRoot: ws }))).toBeNull();
});

it("single-quotes rewritten queries so backticks and $ stay literal", () => {
  expect(quoteQuery("a `su` $HOME it's")).toBe("'a `su` $HOME it'\\''s'");
});

function setBash(command: string, sid: string | null = "sess1") {
  const extra = { workspaceRoot: tmp.dir("gate-set-"), ...(sid === null ? {} : { sessionId: sid }) };

  return processFatTools(camelCall("Bash", { command }, extra));
}

describe("repo set", () => {
  it.each(["bun repo set away", "rtk bun repo set away", "bun bin/repo.ts set away", "bun repo set away spawn-fast"])(
    "appends the session id to %j",
    (command) => {
      expect(commandOf(setBash(command))).toBe(`${command} --session sess1`);
    },
  );

  it("takes the id from the session the payload names", () => {
    expect(commandOf(setBash("bun repo set deep", "abc-9"))).toBe("bun repo set deep --session abc-9");
  });

  it.each([
    "bun repo set --session mine away",
    "bun repo set away --session mine",
    "bun repo set --session=mine away",
    "cd x && bun repo set away",
    "cd '/tmp/some dir' && bun repo set away",
    "bun repo set away; echo done",
    "echo bun repo set away | cat",
  ])("leaves %j alone", (command) => {
    expect(setBash(command)).toBeNull();
  });

  it("leaves the command alone when the call names no session", () => {
    expect(setBash("bun repo set away", null)).toBeNull();
  });

  it("leaves other bun repo commands alone", () => {
    expect(setBash("bun repo settings away")).toBeNull();
    expect(setBash("bun repo setup away")).toBeNull();
  });
});
