import { defineEval } from "../../../spec.ts";

export default defineEval({
  cases: [{ id: "a", input: "x", pass: () => true, source: "fixture" }],
  files: ["evals/sample", "evals/sample/eval.ts"],
  system: "s",
});
