import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function listJs(dir) {
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".mjs") || n.endsWith(".js"))
    .map((n) => path.join(dir, n));
}

describe("lf endings", () => {
  it("scripts, cli, and bin have no CR (Windows ESM shebang parse)", () => {
    const files = [
      ...listJs(path.join(root, "scripts")),
      ...listJs(path.join(root, "cli")),
      ...listJs(path.join(root, "bin")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const abs of files) {
      const buf = fs.readFileSync(abs);
      expect(buf.includes(0x0d), path.relative(root, abs)).toBe(false);
    }
  });
});
