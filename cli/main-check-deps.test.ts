import { expect, it, vi } from "vitest";

import { latestFetch, usePacks, writeConfigs } from "./__fixtures__/check-repo.ts";
import { KIT } from "./__fixtures__/deps-kit.ts";
import { useMainCheckRepo } from "./__fixtures__/main-check-repo.ts";
import { start } from "./main.ts";

const { fakes, repo } = useMainCheckRepo();

vi.setConfig({ testTimeout: 60_000 });

const APP = { bin: { app: "./bin.js" }, exports: { ".": "./src/index.ts" }, name: "app", private: false };

/** A repo whose public bin package's export type imports the installed `kit`. */
function writeKitRepo(): void {
  writeConfigs(repo);
  usePacks(repo);
  repo.put("src/index.ts", 'import type { Kit } from "kit";\nexport type Api = Kit;\n');
  repo.write("node_modules/kit/package.json", { name: "kit", types: "index.d.ts" });
  repo.put("node_modules/kit/index.d.ts", KIT.kit?.types ?? "");
}

it("fails a public bin package whose export types use a dependency, and passes once it is a peer", async () => {
  writeKitRepo();
  repo.write("package.json", { ...APP, dependencies: { kit: "1.0.0" } });
  await start(fakes);

  expect(repo.besidesKnip()).toContain(
    'repo check: package.json: kit is in "dependencies" but the types of "." use it (src/index.ts); ' +
      'move it to "peerDependencies" and "devDependencies" keeping its version\n',
  );
  expect(process.exitCode).toBe(1);
  repo.write("package.json", { ...APP, devDependencies: { kit: "1.0.0" }, peerDependencies: { kit: "1.0.0" } });
  process.exitCode = 0;
  const first = repo.besidesKnip().length;
  await start(fakes);
  expect(repo.besidesKnip().slice(first)).not.toContain('is in "dependencies"');
});

it("prints a line for a package whose types cannot be read, skips one with no dependencies, and runs on", async () => {
  writeKitRepo();
  repo.put("x", "a file where the export's dir should be\n");
  vi.stubGlobal("fetch", latestFetch("999.0.0"));
  repo.write("package.json", { ...APP, exports: { "./x/*": "./x/*.ts" } });
  await start(fakes);
  expect(repo.besidesKnip()).not.toContain("could not read the types");
  repo.write("package.json", { ...APP, dependencies: { kit: "1.0.0" }, exports: { "./x/*": "./x/*.ts" } });
  await start(fakes);
  const printed = repo.besidesKnip();

  expect(printed).toContain("repo check: package.json: could not read the types of its exports (ENOTDIR");
  expect(printed).toContain("is behind 999.0.0 on npm");
});
