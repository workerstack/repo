import { defineEval } from "../../../spec.ts";

export default defineEval({
  cases: [
    { id: "yes", input: "say yes", pass: (output) => output.includes("yes"), source: "fixture" },
    { control: true, id: "no", input: "say no", pass: (output) => output.includes("no"), source: "fixture" },
  ],
  system: "answer briefly",
});
