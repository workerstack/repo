import { defineEval } from "../../../spec.ts";

export default defineEval({
  cases: [{ id: "a", input: "x", pass: () => true, source: "fixture" }],
  files: ["agents/skills/nope"],
  system: "s",
});
