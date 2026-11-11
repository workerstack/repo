/** The fresh-repo cases on regenerating the trees: from scratch, offline, on a bad config and with fewer hosts. */
import fs from "node:fs";
import path from "node:path";

import { expect, inject, it } from "vitest";

import type { GetSandbox } from "./get-sandbox.types";
import { expectClean, generatedHashes, hashes, ignoredFiles, removeGenerated, setHosts } from "./init-helpers";
import { PACKAGE_NAME } from "./registry";
import { tail } from "./tail";

/** Install rebuilds every deleted generated file byte for byte, and sync needs no registry. */
export function regenerateCases(get: GetSandbox) {
  it("deleting every ignored generated file and running bun install reproduces each byte for byte", async () => {
    const sb = get();
    const before = await generatedHashes(sb);
    expect(before.length).toBeGreaterThan(50);
    expect(
      before.some((l) => l.includes(" -> ")),
      "links",
    ).toBe(true);
    for (const rel of await ignoredFiles(sb)) removeGenerated(path.join(sb.repo, rel));
    expect((await generatedHashes(sb)).length).toBe(0);
    expectClean(sb, await sb.run("bun", ["install"]));
    expect(await generatedHashes(sb)).toStrictEqual(before);
    expect((await sb.git("status", "--porcelain")).stdout).toBe("");
  });

  it("sync works with the registry unreachable", async () => {
    const sb = get();
    const before = await generatedHashes(sb);
    fs.rmSync(path.join(sb.repo, ".claude", "settings.json"));
    fs.rmSync(path.join(sb.repo, "AGENTS.md"));
    expect(inject("registryUrl")).not.toContain("127.0.0.1:9/");
    const offline = {
      BUN_CONFIG_REGISTRY: "http://127.0.0.1:9/",
      HTTPS_PROXY: "http://127.0.0.1:9",
      HTTP_PROXY: "http://127.0.0.1:9",
    };
    expectClean(sb, await sb.run("bun", ["repo", "sync"], { env: offline }));
    expect(await generatedHashes(sb)).toStrictEqual(before);
  });
}

/** An unknown config key fails sync but not install, and install then changes no file. */
export function unknownKeyCase(get: GetSandbox) {
  it("an unknown config key fails sync, while install prints it, exits 0 and changes no file", async () => {
    const sb = get();
    const original = sb.read("workerstack.config.ts");
    sb.write("workerstack.config.ts", original.replace("agents:", "bogusKey: true,\n  agents:"));
    try {
      const keep = () => true;
      const before = hashes(sb.repo, keep);
      const sync = await sb.run("bun", ["repo", "sync"]);
      expect(sync.status, tail(sync.out)).toBe(1);
      expect(sync.stderr).toContain('unknown key "bogusKey"');
      const install = await sb.run("bun", ["install"]);
      expect(install.status, tail(install.out)).toBe(0);
      expect(install.out).toContain('unknown key "bogusKey"');
      expect(hashes(sb.repo, keep)).toStrictEqual(before);
    } finally {
      sb.write("workerstack.config.ts", original);
    }
    expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
  });
}

/** Fewer hosts prune the others' trees, and restoring them brings the same bytes back. */
export function hostsCase(get: GetSandbox) {
  it("limiting agents.hosts prunes the other trees, and restoring them brings the trees back", async () => {
    const sb = get();
    const before = await generatedHashes(sb);
    const original = sb.read("workerstack.config.ts");
    try {
      setHosts(sb, ["claude"]);
      expectClean(sb, await sb.run("bun", ["repo", "sync"]));
      for (const rel of [".codex", ".agents", ".grok", ".cursor"]) expect(sb.exists(rel), rel).toBe(false);
      for (const rel of ["AGENTS.md", ".mcp.json", ".claude/settings.json"]) expect(sb.exists(rel), rel).toBe(true);
      expectClean(sb, await sb.run("bun", ["repo", "sync", "--check"]));
    } finally {
      sb.write("workerstack.config.ts", original);
      await sb.run("bun", ["repo", "sync"]);
    }
    expect(await generatedHashes(sb)).toStrictEqual(before);
  });
}

/** Re-running init on the committed result changes nothing. */
export function reinitCase(get: GetSandbox) {
  it("re-init is idempotent", async () => {
    const sb = get();
    await sb.commit("first init");
    expectClean(sb, await sb.launch(PACKAGE_NAME, "init"));
    expect((await sb.git("status", "--porcelain")).stdout).toBe("");
  });
}
