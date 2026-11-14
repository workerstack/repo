import { describe, expect, it } from "vitest";

import { fastPlan, plan, roadmap } from "./__fixtures__/orchestrate-kit.ts";
import { clicked } from "./__fixtures__/picker-kit.ts";
import { type AskInput, askInputSchema, isApprovalPicker, pickerInput, pickerReply } from "./approval-picker.ts";

const REASON = "the hook and gate change together";
const ADVISED = plan(4, "spawn-fast", `spawn-deep because ${REASON}`);

const RENDERED = {
  questions: [
    {
      header: "Approval",
      multiSelect: false,
      options: [
        { description: "run it in this session", label: "Implement" },
        { description: "write a handoff to run in a fresh session", label: "Hand off" },
      ],
      question: "plan 4 · spawn-fast: implement it here, or hand it off?",
    },
    {
      header: "Strategy",
      multiSelect: false,
      options: [
        { description: "saved in the file", label: "spawn-fast" },
        { description: `advice: ${REASON}`, label: "spawn-deep" },
        { description: "this session does every phase itself", label: "free" },
      ],
      question: "Which strategy?",
    },
  ],
};

describe("pickerInput", () => {
  it("renders one plan with advice as the approval and strategy questions", () => {
    expect(pickerInput([ADVISED])).toStrictEqual(RENDERED);
  });

  it("puts the advice on the saved option when the advice names the saved value", () => {
    const agrees = plan(4, "spawn-deep", `spawn-deep because ${REASON}`);
    const options = pickerInput([agrees]).questions[1]?.options;

    expect(options?.map((o) => o.label)).toStrictEqual(["spawn-deep", "spawn-fast", "free"]);
    expect(options?.[0]?.description).toBe(`saved in the file; advice: ${REASON}`);
  });

  it("lists the saved value first and has no advice text when the plan holds none", () => {
    const options = pickerInput([plan(1, "free")]).questions[1]?.options;

    expect(options?.map((o) => o.label)).toStrictEqual(["free", "spawn-fast", "spawn-deep"]);
    expect(options?.[0]?.description).toBe("saved in the file");
  });

  it("starts a mixed queue's strategy options with as saved and names what each item holds", () => {
    const input = pickerInput([plan(4, "spawn-fast"), roadmap(2, "free")]);
    const options = input.questions[1]?.options;

    expect(options?.[0]).toStrictEqual({ description: "plan 4 spawn-fast, roadmap 2 free", label: "as saved" });
    expect(options?.length).toBeLessThanOrEqual(4);
  });

  it("asks the strategy question for a queue of only fast items, saved value then advice first", () => {
    const input = pickerInput([fastPlan(1, "spawn-fast", "free because one file")]);

    expect(input.questions.map((q) => q.header)).toStrictEqual(["Approval", "Strategy"]);
    expect(input.questions[1]?.options.map((o) => o.label)).toStrictEqual(["spawn-fast", "free", "spawn-deep"]);
  });

  it("refuses an empty queue", () => {
    expect(() => pickerInput([])).toThrow("pickerInput needs at least one item");
  });
});

describe("pickerReply", () => {
  it("reads a click on the saved strategy as a bare reply", () => {
    const out = pickerReply(clicked([ADVISED], { approval: "Implement", strategy: "spawn-fast" }));

    expect(out).toStrictEqual({ named: [plan(4, "spawn-fast")], reply: { kind: "approve", strategy: null } });
  });

  it("reads a click on another strategy as that strategy word", () => {
    const out = pickerReply(clicked([ADVISED], { approval: "Implement", strategy: "spawn-deep" }));

    expect(out).toStrictEqual({ named: [plan(4, "spawn-fast")], reply: { kind: "approve", strategy: "spawn-deep" } });
  });

  it("reads Hand off with a strategy as a handoff with that strategy", () => {
    const out = pickerReply(clicked([ADVISED], { approval: "Hand off", strategy: "free" }));

    expect(out).toStrictEqual({ named: [plan(4, "spawn-fast")], reply: { kind: "handoff", strategy: "free" } });
  });
});

describe("pickerReply for queues and typed answers", () => {
  it("reads as saved as a bare reply and names every item of a mixed queue", () => {
    const items = [plan(4, "spawn-fast"), roadmap(2, "free")];
    const out = pickerReply(clicked(items, { approval: "Implement", strategy: "as saved" }));

    expect(out).toStrictEqual({ named: items, reply: { kind: "approve", strategy: null } });
  });

  it("reads a fast-only click on another strategy as that strategy word", () => {
    const out = pickerReply(clicked([fastPlan(1)], { approval: "Hand off", strategy: "spawn-deep" }));

    expect(out).toStrictEqual({ named: [fastPlan(1)], reply: { kind: "handoff", strategy: "spawn-deep" } });
  });

  it("reads a typed answer that is no option as feedback on the named items", () => {
    const out = pickerReply(clicked([ADVISED], { approval: "make it shorter", strategy: "spawn-deep" }));

    expect(out).toStrictEqual({ feedback: "make it shorter", named: [plan(4, "spawn-fast")] });
  });

  it("is null for an input with no approval question", () => {
    const question = { header: "Pick", multiSelect: false, options: [], question: "Which?" };
    const other = { answers: { "Which?": "Beta" }, questions: [question] };

    expect(pickerReply(askInputSchema.parse(other))).toBeNull();
  });
});

type Change = Partial<AskInput["questions"][number]>;

/** The clicked picker whose approval question is changed by `change`, with `pick` answered to it. */
function answeredWith(pick: string, change: Change) {
  const input = clicked([ADVISED], { approval: pick });
  const [approval, ...rest] = input.questions;
  const changed = { ...approval, ...change };

  return askInputSchema.parse({ answers: { [String(changed.question)]: pick }, questions: [changed, ...rest] });
}

describe("pickerReply for an input the hook did not render", () => {
  it("is null when the approval question carries no header the typed block could", () => {
    expect(pickerReply(answeredWith("Implement", { question: "Approve?" }))).toBeNull();
  });

  it("is null when the answer is an option label that is neither implement nor hand off", () => {
    expect(pickerReply(answeredWith("Maybe", { options: [{ description: "d", label: "Maybe" }] }))).toBeNull();
  });
});

describe("askInputSchema", () => {
  it("refuses an input that is no list of questions", () => {
    for (const bad of [null, "x", {}, { questions: "x" }, { questions: [{ header: 1 }] }])
      expect(askInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("accepts the picker with answers and with none", () => {
    expect(askInputSchema.safeParse(pickerInput([ADVISED])).success).toBe(true);
    expect(askInputSchema.safeParse(clicked([ADVISED], { approval: "Implement" })).success).toBe(true);
  });
});

describe("isApprovalPicker", () => {
  it("is true for a rendered approval picker and false for an unrelated one", () => {
    expect(isApprovalPicker(pickerInput([ADVISED]))).toBe(true);
    expect(isApprovalPicker(pickerInput([fastPlan(1)]))).toBe(true);

    const other = askInputSchema.parse({
      questions: [{ header: "Color", multiSelect: false, options: [], question: "Which color?" }],
    });

    expect(isApprovalPicker(other)).toBe(false);
  });
});
