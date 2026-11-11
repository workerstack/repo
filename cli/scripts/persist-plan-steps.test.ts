import { describe, expect, it } from "vitest";

import { savedOk } from "./fixtures/persist-bodies.ts";
import {
  CARDED,
  above,
  leanKit,
  pad,
  read,
  stripCard,
  update,
  useTmpWs,
  withSteps,
} from "./fixtures/persist-plan-kit.ts";

const tmpWs = useTmpWs();
const { save, saved, legacy } = leanKit(tmpWs);

const capError = (n: number) =>
  `${n} lines above ## Previous mistakes, the cap is 100; split it into a roadmap (/write-roadmap)`;
// Lines the saved frontmatter and the carded body put above Previous mistakes.
function baseline() {
  return above(read(saved().abs));
}

describe("100-line cap", () => {
  it("saves a fresh plan at exactly 100 lines and denies 101", () => {
    const base = baseline();
    const at = save(pad(CARDED, 100 - base));
    expect(at.ok, at.error).toBe(true);
    expect(above(savedOk(at).content)).toBe(100);
    const over = save(pad(CARDED, 101 - base));
    expect(over.ok).toBe(false);
    expect(over.errors).toContain(capError(101));
  });

  it("lets a 438-line legacy plan flip a box but not grow", () => {
    const s = legacy((t) => {
      const bare = stripCard(t);
      return pad(bare, 438 - above(bare));
    });
    expect(above(read(s.abs))).toBe(438);
    const flipped = read(s.abs).replace("1.1 [ ]", "1.1 [x]");
    const r = update(s.ws, s.abs, flipped);
    expect(r.ok, r.error).toBe(true);
    const grown = update(s.ws, s.abs, pad(flipped, 1));
    expect(grown.ok).toBe(false);
    expect(grown.errors).toContain(capError(439));
  });
});

describe("100-line cap and Previous mistakes", () => {
  it("never counts Previous mistakes", () => {
    const entries = Array.from({ length: 150 }, (_, i) => `- review: miss ${i} → fix ${i}`).join("\n");
    const r = save(
      pad(CARDED, 100 - baseline()).replace("## Previous mistakes\n(none)", `## Previous mistakes\n${entries}`),
    );
    expect(r.ok, r.error).toBe(true);
  });
});

const READS_PHASE = [
  "1 [ ] Read principles",
  "1.1 [ ] read `principle-test-behavior-not-implementation`",
  "1.2 [ ] read `principle-boundary-discipline`",
  "2 [ ] gitignore",
  "2.1 [ ] read the gitignore if it exists",
  "2.2 [ ] append .tmp/ when absent",
];
const VERIFY = ["3 [ ] Verify", "3.1 [ ] git check-ignore reports ignored"];

describe("principle reads", () => {
  it("denies a fresh plan with a phase that only reads principles", () => {
    const r = save(withSteps(CARDED, READS_PHASE, VERIFY));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("phase 1 only reads principles; move each read into the phase it gates");
  });

  it("lets a saved plan that already has a reads phase flip a box", () => {
    const s = legacy((t) => withSteps(t, READS_PHASE, VERIFY));
    const r = update(s.ws, s.abs, read(s.abs).replace("2.1 [ ]", "2.1 [x]"));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies an update that adds a reads phase the saved plan did not have", () => {
    const s = saved();
    const r = update(s.ws, s.abs, withSteps(read(s.abs), READS_PHASE, VERIFY));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("phase 1 only reads principles; move each read into the phase it gates");
  });

  it("saves a Verify that reads a principle and runs a command", () => {
    const r = save(
      withSteps(
        CARDED,
        ["1 [ ] gitignore", "1.1 [ ] append .tmp/ when absent"],
        ["2 [ ] Verify", "2.1 [ ] read `principle-prove-it-works`", "2.2 [ ] git check-ignore reports ignored"],
      ),
    );
    expect(r.ok, r.error).toBe(true);
  });
});

const phase = (n: number, title: string, files?: string) => [
  `${n} [ ] ${title}${files ? ` (parallel: ${files})` : ""}`,
  `${n}.1 [ ] do the ${title.toLowerCase()} work`,
];
const verify = (n: number) => [`${n} [ ] Verify`, `${n}.1 [ ] git check-ignore reports ignored`];

describe("parallel phases", () => {
  it("saves adjacent parallel phases with disjoint files", () => {
    const steps = [
      ...phase(1, "Setup"),
      ...phase(2, "Parser", "src/parse.ts, src/parse.test.ts"),
      ...phase(3, "Printer", "src/print.ts, src/print.test.ts"),
    ];
    const r = save(withSteps(CARDED, steps, verify(4)));
    expect(r.ok, r.error).toBe(true);
  });

  it("denies parallel phases that share a file, whichever separator it uses", () => {
    const steps = [
      ...phase(1, "Setup"),
      ...phase(2, "Parser", "src/cli.ts, src/parse.ts"),
      ...phase(3, "Printer", "src\\cli.ts, src/print.ts"),
    ];
    const r = save(withSteps(CARDED, steps, verify(4)));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("parallel phases 2 and 3 both list src/cli.ts; parallel phases need disjoint files");
  });
});

describe("parallel phases without files", () => {
  it("denies a parallel phase that lists no files", () => {
    const steps = [...phase(1, "Parser", "src/parse.ts"), `2 [ ] Printer (parallel: )`, "2.1 [ ] do the printer work"];
    const r = save(withSteps(CARDED, steps, verify(3)));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("phase 2 is parallel with no files; list the files it writes after parallel:");
  });
});

describe("parallel phases alone", () => {
  it("denies a parallel phase with no adjacent parallel phase", () => {
    const alone = [
      ...phase(1, "Setup"),
      ...phase(2, "Parser"),
      ...phase(3, "Wire"),
      ...phase(4, "Printer", "src/print.ts"),
    ];
    const r = save(withSteps(CARDED, alone, verify(5)));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("phase 4 is parallel alone; parallel needs two or more adjacent phases");
    const apart = [
      ...phase(1, "Setup"),
      ...phase(2, "Parser", "src/parse.ts"),
      ...phase(3, "Wire"),
      ...phase(4, "Printer", "src/print.ts"),
    ];
    const split = save(withSteps(CARDED, apart, verify(5)));
    expect(split.ok).toBe(false);
    expect(split.errors).toContain("phase 2 is parallel alone; parallel needs two or more adjacent phases");
    expect(split.errors).toContain("phase 4 is parallel alone; parallel needs two or more adjacent phases");
  });
});
