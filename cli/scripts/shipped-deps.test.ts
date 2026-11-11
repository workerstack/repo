import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
) /* the package manifest lists files and may list dependencies */ as {
  files: string[];
  dependencies?: Record<string, string>;
};

/** Shipped code a launcher (bunx) runs from the package itself, without the consumer's deps. */
const CODE_ROOTS = ["bin", "cli"];
const CODE_FILE = /\.(?:ts|mjs|cjs|js)$/;
const SPECIFIER = String.raw`["']((?:@[\w.-]+\/)?[\w.-]+(?:\/[\w./-]+)?|node:[\w/]+)["']`;
const IMPORT = new RegExp(
  [
    String.raw`^\s*(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?${SPECIFIER}`,
    String.raw`\b(?:import|require)\(\s*${SPECIFIER}\s*\)`,
  ].join("|"),
  "gm",
);

/** Package-relative POSIX paths, the same form as package.json "files", on every OS. */
function walk(rel: string): string[] {
  const abs = path.join(root, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).flatMap((name) => walk(path.posix.join(rel, name)));
}

/** Each package `rel` imports that package.json does not list under dependencies, as `<rel> imports <name>`. */
function undeclaredImports(rel: string): string[] {
  return packageImports(rel)
    .filter((name) => pkg.dependencies?.[name] === undefined)
    .map((name) => `${rel} imports ${name}`);
}

function shippedCode(): string[] {
  return pkg.files
    .filter((entry) => CODE_ROOTS.includes(entry.split("/")[0] ?? ""))
    .flatMap(walk)
    .filter((rel) => CODE_FILE.test(rel) && !rel.includes(".test.") && !rel.includes("/fixtures/"));
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? ""); // split always yields one part
}

function packageImports(rel: string): string[] {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  return (
    [...source.matchAll(IMPORT)]
      // One of the two groups matches in every hit.
      .map((m) => m[1] ?? m[2] ?? "")
      .filter((specifier) => !specifier.startsWith("node:") && !specifier.startsWith("."))
      .map(packageName)
  );
}

describe("shipped code dependencies", () => {
  it("sees the shipped code and the packages it imports", () => {
    const files = shippedCode();
    expect(files).toContain("cli/scripts/emit-mcp-policy.ts");
    expect(packageImports("cli/scripts/emit-mcp-policy.ts")).toContain("smol-toml");
    expect(new Set(files.flatMap(packageImports))).toContain("cross-spawn");
  });

  it("declares every package the shipped code imports under dependencies", () => {
    expect(shippedCode().flatMap(undeclaredImports)).toStrictEqual([]);
  });
});
