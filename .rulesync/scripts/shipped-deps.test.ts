import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

/** Shipped code a launcher (npx, bunx, dlx) runs from the package itself, without the consumer's deps. */
const CODE_ROOTS = ["bin", "cli", "scripts"];
const CODE_FILE = /\.(?:mjs|cjs|js)$/;
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

function shippedCode(): string[] {
  return (pkg.files as string[])
    .filter((entry) => CODE_ROOTS.includes(entry.split("/")[0]))
    .flatMap(walk)
    .filter((rel) => CODE_FILE.test(rel) && !rel.includes(".test."));
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function packageImports(rel: string): string[] {
  const source = fs.readFileSync(path.join(root, rel), "utf8");
  return [...source.matchAll(IMPORT)]
    .map((m) => m[1] ?? m[2])
    .filter((specifier) => !specifier.startsWith("node:") && !specifier.startsWith("."))
    .map(packageName);
}

describe("shipped code dependencies", () => {
  it("sees the shipped code and the packages it imports", () => {
    const files = shippedCode();
    expect(files).toContain("scripts/emit-mcp-policy.mjs");
    expect(packageImports("scripts/emit-mcp-policy.mjs")).toContain("smol-toml");
    expect(new Set(files.flatMap(packageImports))).toContain("cross-spawn");
  });

  it("declares every package the shipped code imports under dependencies", () => {
    const missing = shippedCode().flatMap((rel) =>
      packageImports(rel)
        .filter((name) => !pkg.dependencies?.[name])
        .map((name) => `${rel} imports ${name}`),
    );
    expect(missing).toEqual([]);
  });
});
