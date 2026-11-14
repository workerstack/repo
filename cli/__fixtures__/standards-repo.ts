/** A temp repo for the `lint.ts` spawn tests: the standards pack on and an oxlint config, so `runTool` reaches the spawn. */
import fs from "node:fs";
import path from "node:path";

/** Writes the standards repo into `root`, an empty temp dir, and returns it. */
export function standardsRepo(root: string): string {
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "app", "type": "module" }\n');
  fs.writeFileSync(path.join(root, "repo.config.ts"), 'export default { packs: ["standards"] };\n');
  fs.writeFileSync(path.join(root, ".oxlintrc.jsonc"), "{}\n");

  return root;
}
