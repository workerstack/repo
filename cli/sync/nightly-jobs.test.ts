import { describe, expect, it } from "vitest";
import { context } from "../fixtures/release-context.ts";
import { nightly } from "./nightly.ts";
import type { SyncContext } from "./outputs.ts";

/** The nightly.yml text for `shards`, `secrets` and a root manifest with or without `test:live`. */
function render(shards: number, secrets: string[] = [], live = false): string {
  const base = context(["release"], live ? { scripts: { "test:live": "vitest run -c live.config.ts" } } : {});
  const ctx: SyncContext = { ...base, config: { ...base.config, nightly: { shards, secrets } } };
  const [output] = nightly(ctx).outputs;
  if (output?.kind !== "file") throw new Error("no nightly.yml");
  return output.content;
}

const liveJob = (text: string) => text.slice(text.indexOf("  live:"));

describe("nightly jobs", () => {
  it("fans the mutate job out over every shard of the config", () => {
    const text = render(8);
    expect(text).toContain("name: mutate (${{ matrix.shard }}/8)");
    expect(text).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
    expect(text).toContain('run: bun repo mutate --shard "$SHARD/8" --report "mutation-$SHARD.json"');
  });

  it("names each upload by its shard and downloads by the same prefix", () => {
    const text = render(3);
    expect(text).toContain("name: mutation-${{ matrix.shard }}\n          path: mutation-${{ matrix.shard }}.json");
    expect(text).toContain("pattern: mutation-*\n          merge-multiple: true");
  });
});

describe("nightly live job", () => {
  it("has no live job without a test:live script, secrets or not", () => {
    expect(render(1)).not.toContain("live");
    expect(render(1, ["API_TOKEN"])).not.toContain("live");
  });

  it("adds a live job with a 40-minute limit that runs test:live", () => {
    const job = liveJob(render(1, [], true));
    expect(job).toContain("timeout-minutes: 40");
    expect(job).toContain("      - run: bun run test:live\n");
    expect(job).not.toContain("env:");
    expect(job).not.toContain("needs:");
  });

  it("maps each secret by name in the live job's env, never inside run", () => {
    const job = liveJob(render(1, ["API_TOKEN", "OTHER_KEY"], true));
    expect(job).toContain(
      "    env:\n      API_TOKEN: ${{ secrets.API_TOKEN }}\n      OTHER_KEY: ${{ secrets.OTHER_KEY }}\n",
    );
    expect(job).not.toMatch(/run:.*secrets/);
  });

  it("never triggers on a push or a pull request", () => {
    expect(render(1)).not.toMatch(/push|pull_request/);
  });

  it("pins every action to a full commit SHA", () => {
    const uses = render(2, [], true).match(/uses: \S+/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}$/);
  });
});
