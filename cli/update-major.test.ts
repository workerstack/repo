import { afterEach, expect, it } from "vitest";

import { cleanup, world } from "./__fixtures__/update-world.ts";
import { main } from "./update.ts";

afterEach(cleanup);

/** A one-manifest repo whose package.json lists `dependencies`. */
function root(dependencies: Record<string, string>) {
  return { "package.json": { dependencies, name: "r" } };
}

it("a scope takes the majors of what it matches", async () => {
  const w = world(root({ "@s/a": "^1.0.0", b: "^1.0.0" }), { "@s/a": "2.0.0", b: "2.0.0" });
  expect(await main(["@s/*"], w.io())).toBe(0);
  expect(w.out).toStrictEqual(["updated 1: @s/a ^1.0.0 → ^2.0.0 in package.json"]);
  expect(w.read("package.json").dependencies).toStrictEqual({ "@s/a": "^2.0.0", b: "^1.0.0" });
});

it("marks a 0.x minor and a 0.0.x patch major, and not a prerelease to its release", async () => {
  const w = world(root({ a: "0.157.0", b: "^0.0.3", c: "0.2.0-rc.2", d: "1.2.0" }), {
    a: "0.158.0",
    b: "0.0.4",
    c: "0.2.0",
    d: "1.3.0",
  });

  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([
    "4 behind of 4 checked:",
    "  a  package.json         0.157.0 → 0.158.0  major",
    "  b  package.json         ^0.0.3 → ^0.0.4  major",
    "  c  package.json         0.2.0-rc.2 → 0.2.0",
    "  d  package.json         1.2.0 → 1.3.0",
    "run `bun repo update` for minor and patch, `bun repo update --major` for all, " +
      "or `bun repo update <name>` for some",
  ]);
  await main([], w.io());
  expect(w.read("package.json").dependencies).toStrictEqual({ a: "0.157.0", b: "^0.0.3", c: "0.2.0", d: "1.3.0" });
});

it("--check with no major keeps the plain follow-up", async () => {
  const w = world(root({ d: "1.2.0" }), { d: "1.3.0" });
  expect(await main(["--check"], w.io())).toBe(0);
  expect(w.out.at(-1)).toBe("run `bun repo update` to write them, or `bun repo update <name>` for some");
});
