import { afterEach, expect, it } from "vitest";

import { cleanTemps, consumer, git, read, SLOW, staged, turn, write } from "./__fixtures__/turn-repo.ts";

afterEach(cleanTemps);

it(
  "turn's fmt step converts a staged own-line block comment in a .jsonc and restages it",
  { timeout: SLOW },
  async () => {
    const root = consumer({ "data.jsonc": '{\n  "a": 1\n}\n' });
    write(root, { "data.jsonc": '{\n  /*\n   * why\n   */\n  "a": 1,\n  "b": /* inline */ 2\n}\n' });
    git(root, "add", "-f", "data.jsonc");
    const result = await turn(root, ["--staged"]);
    expect(result.out).toMatch(/^turn: 1 file · fmt 1 fixed · /);
    expect(staged(root)).toStrictEqual(["data.jsonc"]);
    expect(git(root, "show", ":data.jsonc")).toBe('{\n  // why\n  "a": 1,\n  "b": /* inline */ 2\n}\n');
    expect(read(root, "data.jsonc")).toBe(git(root, "show", ":data.jsonc"));
  },
);
