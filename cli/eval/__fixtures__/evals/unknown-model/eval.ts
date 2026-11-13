import { defineEval } from "../../../spec.ts";

export default defineEval({
  cases: [{ id: "one", input: "hi", pass: () => true, source: "fixture" }],
  model: "gpt-nope",
  system: "answer briefly",
});
