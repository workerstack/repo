import fs from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { NO_DEPENDENTS, consumer, counted, packsLog } from "./__fixtures__/link-push-world.ts";
import { NAME, scene, sibling, versionIn } from "./__fixtures__/link-world.ts";
import { readDependents, registerDependent } from "./link-dependents.ts";
import { readState, writeState } from "./link-state.ts";
import { main } from "./link.ts";
import { removeTree } from "./remove-tree.ts";

it("packs once and installs into each dependent, printing one line each", async () => {
  const w = scene();
  counted(w);
  const one = consumer(w, "one");
  const two = consumer(w, "two");
  expect(await main(["push"], w.io())).toBe(0);
  expect(w.out.toSorted()).toStrictEqual(
    [`repo link: pushed ${NAME} 0.6.0 to ${one}`, `repo link: pushed ${NAME} 0.6.0 to ${two}`].toSorted(),
  );
  expect(w.err).toStrictEqual([]);
  expect(packsLog(w)).toHaveLength(1);
  expect(versionIn(one, NAME)).toBe("0.6.0");
  expect(versionIn(two, NAME)).toBe("0.6.0");
  expect(fs.readdirSync(path.join(w.main, ".repo/tmp/push"))).toStrictEqual([]);
});

it("keeps the npm version and stamps a new syncedAt in the consumer's state", async () => {
  const w = scene();
  const one = consumer(w, "one");
  await main(["push"], w.io());
  const entry = readState(one)[NAME];
  expect(entry?.npm).toBe("0.3.2");
  expect(entry?.source).toBe(w.flare);
  expect(entry?.syncedAt).toBe(new Date(2026, 10, 10, 8, 31).toISOString());
});

it("gives the same result on a second push", async () => {
  const w = scene();
  const one = consumer(w, "one");
  await main(["push"], w.io());
  const first = fs.readFileSync(path.join(one, "node_modules", NAME, "index.js"), "utf8");
  w.out.length = 0;
  expect(await main(["push"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([`repo link: pushed ${NAME} 0.4.0-dev to ${one}`]);
  expect(fs.readFileSync(path.join(one, "node_modules", NAME, "index.js"), "utf8")).toBe(first);
});

it("says so when no repo links this checkout", async () => {
  const w = scene();
  expect(await main(["push"], w.io())).toBe(0);
  expect(w.out).toStrictEqual([NO_DEPENDENTS]);
});

it("drops a gone root and a root that no longer links the package, and pushes the rest", async () => {
  const w = scene();
  const good = consumer(w, "good");
  const gone = consumer(w, "gone");
  removeTree(gone);
  const away = consumer(w, "moved");
  writeState(away, { [NAME]: { npm: null, source: path.join(w.base, "else"), syncedAt: "2026-11-10T08:31:00.000Z" } });
  const bare = consumer(w, "bare");
  writeState(bare, {});
  const broken = consumer(w, "broken");
  fs.writeFileSync(path.join(broken, ".repo/tmp/links.json"), "{");
  expect(await main(["push"], w.io())).toBe(0);

  const lines = [bare, broken, gone, away].map(
    (root) => `repo link: warning: ${root} is gone or no longer links ${NAME}; dropped it`,
  );

  expect(w.err.toSorted()).toStrictEqual(lines.toSorted());
  expect(w.out).toStrictEqual([`repo link: pushed ${NAME} 0.4.0-dev to ${good}`]);
  expect(readDependents(w.main, () => {}).map((one) => one.root)).toStrictEqual([good]);
});

it("does not stop at a failed install and exits 1", async () => {
  const w = scene();
  const bad = consumer(w, "a-bad");
  fs.writeFileSync(path.join(bad, "node_modules", "@workerstack"), "a file, not a dir");
  const good = consumer(w, "b-good");
  expect(await main(["push"], w.io())).toBe(1);
  expect(w.out).toStrictEqual([`repo link: pushed ${NAME} 0.4.0-dev to ${good}`]);
  expect(w.err).toHaveLength(1);
  expect(w.err[0]).toMatch(
    new RegExp(`^repo link: warning: ${NAME} failed to install in ${bad}; it keeps the last good copy: .+`),
  );
  expect(readDependents(w.main, () => {})).toHaveLength(2);
});

it("reports a pack that fails for each dependent, and exits 1", async () => {
  const w = scene();
  sibling(w.flare, NAME, "0.5.0", { scripts: { prepack: "exit 1" } });
  const one = consumer(w, "one");
  const two = consumer(w, "two");
  expect(await main(["push"], w.io())).toBe(1);
  expect(w.out).toStrictEqual([]);
  expect(w.err).toHaveLength(2);

  for (const root of [one, two]) {
    expect(w.err.some((line) => line.includes(`failed to install in ${root}; it keeps the last good copy:`))).toBe(
      true,
    );
  }
});

it("lists a warning for a dependents file that does not parse and still pushes", async () => {
  const w = scene();
  const one = consumer(w, "one");
  fs.writeFileSync(path.join(w.main, ".repo/tmp/dependents/bad.json"), "{");
  expect(await main(["push"], w.io())).toBe(0);
  expect(w.err).toHaveLength(1);
  expect(w.out).toStrictEqual([`repo link: pushed ${NAME} 0.4.0-dev to ${one}`]);
});

it("takes a root spelled through a symlink as the same root", async () => {
  const w = scene();
  const one = consumer(w, "one");
  fs.symlinkSync(one, path.join(w.base, "alias"));
  registerDependent(w.main, path.join(w.base, "alias"), { dir: w.flare, name: NAME });
  await main(["push"], w.io());
  expect(w.out).toHaveLength(1);
});

it("rejects push with extra arguments", async () => {
  const w = scene();
  expect(await main(["push", "x"], w.io())).toBe(2);
  expect(await main(["push", "--hook", "x"], w.io())).toBe(2);
  expect(w.err).toHaveLength(2);
});
