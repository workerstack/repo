import { afterEach, expect, it } from "vitest";
import { cleanTemps, consumer, git, SLOW, turn, write } from "./fixtures/turn-repo.ts";
import type { Captured } from "./lint.ts";
import type { Bins } from "./turn-steps.ts";

afterEach(cleanTemps);

const OK: Captured = { code: 0, stdout: "", stderr: "" };

it(
  "a source change that widens a type fails the owner's reject file; once it rejects again the step is ok",
  { timeout: SLOW },
  async () => {
    const user =
      'export type UserId = string & { readonly brand: "UserId" };\nexport const load = (id: UserId): UserId => id;\n';
    const mark = "Argument of type 'string' is not assignable to parameter of type 'UserId'";
    const reject = `import { load } from "./user.ts";\n\n/* rejects: ${mark} */\nload("u1");\n`;
    const root = consumer({
      "src/user.ts": user,
      "src/user.reject.ts": reject,
      "src/other.ts": "export const a = 1;\n",
    });
    const bins: Bins = { tsc: () => OK, vitest: () => null };
    write(root, { "src/user.ts": user.replace(' & { readonly brand: "UserId" }', "") });
    const widened = await turn(root, [], bins);
    expect(widened.out).toBe(
      "turn: 1 file · fmt ok · comments ok · lint ok · typecheck skipped (no tsconfig.json) · rejections 1 failed · related tests skipped (no vitest in .)\n",
    );
    expect(widened.err).toBe(`repo turn: rejections: src/user.reject.ts: line 4 compiles; it must reject: ${mark}\n`);
    expect(widened.code).toBe(1);
    git(root, "checkout", "--", "src/user.ts");
    write(root, { "src/other.ts": "export const a = 2;\n" });
    expect((await turn(root, [], bins)).out).toMatch(/ · typecheck skipped \(no tsconfig\.json\) · rejections ok · /);
  },
);
