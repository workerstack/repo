// The module mocks the suites that drive `start` share. Called from `vi.hoisted`, so the mocks stand before the
// suite's own imports run; `doMock` is used because a `vi.mock` here would hoist inside this file, not the suite's.
import { vi } from "vitest";

import type * as CommandsModule from "../commands.ts";
import type * as GithubApplyModule from "../github-apply.ts";
import type * as InitModule from "../init.ts";
import { mainFakes, type MainFakes } from "./main-kit.ts";

function mockGithub(fakes: MainFakes): void {
  vi.doMock(new URL("../github-apply.ts", import.meta.url).href, async (importOriginal) => {
    const actual = await importOriginal<typeof GithubApplyModule>();
    return {
      ...actual,
      checkGithubAt: (cwd: string) => actual.checkGithubAt(cwd, { ci: false, gh: fakes.githubIo.gh }),
    };
  });
}

/** `mainFakes()` with init, the commands, sync, the folder map and the prompts mocked to them. */
export function mockedMainFakes(): MainFakes {
  const fakes = mainFakes();
  vi.doMock(new URL("../commands.ts", import.meta.url).href, async (importOriginal) => ({
    ...(await importOriginal<typeof CommandsModule>()),
    runCommand: fakes.runCommand,
  }));
  vi.doMock(new URL("../init.ts", import.meta.url).href, async (importOriginal) => ({
    ...(await importOriginal<typeof InitModule>()),
    init: fakes.init,
  }));
  vi.doMock(new URL("../sync.ts", import.meta.url).href, () => ({ runSync: fakes.runSync }));
  vi.doMock(new URL("../scripts/folder-map.ts", import.meta.url).href, () => ({ mapCommand: fakes.mapCommand }));
  vi.doMock(new URL("../prompt.ts", import.meta.url).href, () => fakes);
  return fakes;
}

/** `mockedMainFakes()` with the GitHub check also routed to the fake gh. */
export function mockedGithubFakes(): MainFakes {
  const fakes = mockedMainFakes();
  mockGithub(fakes);
  return fakes;
}
