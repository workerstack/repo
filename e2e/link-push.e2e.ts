/**
 * The generated `reference-transaction` hook driven by real git: a source checkout with the installed bin and
 * `core.hooksPath .githooks`, and a consumer beside it that links it. A commit on main repacks the consumer's copy;
 * other branches, a main that is not out, and a checkout with no bin do not push and never fail git.
 */
import { beforeAll, describe } from "vitest";

import { commitCases, moveCase, noBinCase, startCase } from "./link-push-cases";
import { makeWorld } from "./link-push-kit";
import type { Sandbox } from "./sandbox";

describe("link push from git's reference-transaction hook", () => {
  let made: Sandbox | undefined;

  function get(): Sandbox {
    if (made === undefined) throw new Error("the link-push sandbox is made in beforeAll");

    return made;
  }

  beforeAll(async () => {
    made = await makeWorld();
  });

  startCase(get);
  commitCases(get);
  moveCase(get);
  noBinCase(get);
});
