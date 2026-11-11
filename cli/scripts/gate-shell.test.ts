import { expect, it } from "vitest";
import { processFatTools } from "./gate-fat-tools.ts";
import { quoteQuery } from "./gate-job.ts";
import { useTmp } from "./fixtures/gate-workspace.ts";
import { camelCall, commandOf } from "./fixtures/hook-payload.ts";

const tmp = useTmp();

it("rewrites bash dump to job and ls to rtk", () => {
  const ws = tmp.dir("gate-bash-");
  const bash = (command: string) => processFatTools(camelCall("Bash", { command }, { workspaceRoot: ws }));
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
  ]) {
    expect(processFatTools(camelCall("Bash", { command }, { workspaceRoot: ws }))).toBeNull();
  }
});

it("single-quotes rewritten queries so backticks and $ stay literal", () => {
  expect(quoteQuery("a `su` $HOME it's")).toBe("'a `su` $HOME it'\\''s'");
});
