import { defineEval } from "../../../spec.ts";

export default defineEval({
  cases: [
    { id: "a", input: "i", pass: () => true, source: "s" },
    { id: "a", input: "j", pass: () => true, source: "s" },
  ],
  system: "x",
});
