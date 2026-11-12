import { expect, it } from "vitest";

import { context } from "../__fixtures__/release-context.ts";
import type { Pack } from "../config.ts";
import { release } from "./release.ts";

const CACHE = "actions/cache/%@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0";

const RESTORE = `      - uses: ${CACHE.replace("%", "restore")}
        with:
          path: .turbo/cache
          key: turbo-\${{ runner.os }}-\${{ strategy.job-index }}-\${{ github.sha }}
          restore-keys: turbo-\${{ runner.os }}-\${{ strategy.job-index }}-
`;

const SAVE = `      - uses: ${CACHE.replace("%", "save")}
        if: always() && github.ref == 'refs/heads/main'
        with:
          path: .turbo/cache
          key: turbo-\${{ runner.os }}-\${{ strategy.job-index }}-\${{ github.sha }}
`;

const GATES = "      - name: Run the gates and write the skip report\n";

function text(packs: Pack[]) {
  const [output] = release(context(packs)).outputs;

  return output?.kind === "file" ? output.content : "";
}

it("the turbo cache: each shard restores its own before the gates and saves it after, in the test job only", () => {
  const ci = text(["release", "workspace"]);
  const job = ci.slice(ci.indexOf("  test:"), ci.indexOf("  commits:"));
  expect(job.indexOf(RESTORE)).toBeGreaterThan(job.indexOf("bun install --frozen-lockfile"));
  expect(job.indexOf(RESTORE)).toBeLessThan(job.indexOf(GATES));
  expect(job.indexOf(SAVE)).toBeGreaterThan(job.indexOf("bun repo ci --report"));
  expect(ci.split(RESTORE)).toHaveLength(2);
  expect(ci.split(SAVE)).toHaveLength(2);
  expect(ci.split(".turbo/cache")).toHaveLength(3);
});

it("the turbo cache: writes none without the workspace pack, and the file is the one it always was", () => {
  expect(text(["release"])).not.toContain(".turbo/cache");
  expect(text(["release"])).toBe(text(["release", "docs"]));
});
