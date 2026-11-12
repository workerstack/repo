import { expect, it, vi } from "vitest";

import { buildRepo, cleanDirs, exists, planter } from "./__fixtures__/clean-kit.ts";
import { main } from "./clean.ts";

const tempDir = cleanDirs();

function inRepo(root: string) {
  return vi.spyOn(process, "cwd").mockReturnValue(root);
}

it("repo clean's flags: main refuses --build with --deps, exit 2, and removes nothing", async () => {
  const root = buildRepo(tempDir);
  inRepo(root);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await main(["--build", "--deps"])).toBe(2);
  expect(err).toHaveBeenCalledWith("repo clean: use one of --build or --deps (--deps includes --build)");
  expect(exists(root)(".next")).toBe(true);
});

it("repo clean's flags with a config: main --build runs only the cache removal, with the config's names", async () => {
  const root = buildRepo(tempDir);
  planter(root)("workerstack.config.ts", 0, 'export default { clean: { build: [".flare"] } };\n');
  inRepo(root);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(await main(["--build"])).toBe(0);
  expect(log.mock.calls).toStrictEqual([["removed 3 build dirs and 1 tsbuildinfo file (7 B)"]]);
  expect(exists(root)(".tmp/repo/old.log")).toBe(true);
});

it("repo clean's flags with a config: main works with a config that has no clean section", async () => {
  const root = buildRepo(tempDir);
  planter(root)("workerstack.config.ts", 0, "export default {};\n");
  inRepo(root);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(await main(["--build"])).toBe(0);
  expect(log.mock.calls[0]?.[0]).toBe("removed 2 build dirs and 1 tsbuildinfo file (6 B)");
});

it(
  "repo clean's flags without a usable config: main --deps " +
    "works without a config, and a broken config stops it, exit 1",
  async () => {
    const root = buildRepo(tempDir);
    inRepo(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--deps", "--dry-run"])).toBe(0);
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^would remove 2 build dirs, .* 1 node_modules/);
    planter(root)("workerstack.config.ts", 0, "export default { clean: { build: 1 } };\n");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--build"])).toBe(1);
    expect(err.mock.calls[0]?.[0]).toMatch(/^workerstack.config.ts: clean/);
  },
);
