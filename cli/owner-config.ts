/** The `owner` section of workerstack.config.ts: who a public package's author, LICENSE and CODEOWNERS name. */
import { z } from "zod";

/** Who owns the repo: `author` in public manifests, the LICENSE holder and the GitHub login for CODEOWNERS. */
export type ResolvedOwner = {
  /** The owner's name, as `author` in package.json and the LICENSE holder. */
  readonly name: string;
  /** The GitHub login CODEOWNERS names. */
  readonly github: string;
};

const NAME_ERROR = "must be the owner's name, like Lovro Žagar";
const GITHUB_ERROR = "must be a GitHub login like lovrozagar";
const OBJECT_ERROR = 'must be an object like { name: "Lovro Žagar", github: "lovrozagar" }';

export const ownerSchema = (): z.ZodObject<{ name: z.ZodString; github: z.ZodString }, z.core.$strict> =>
  z.strictObject(
    {
      github: z.string({ error: GITHUB_ERROR }).min(1, { error: GITHUB_ERROR }),
      name: z.string({ error: NAME_ERROR }).min(1, { error: NAME_ERROR }),
    },
    { error: OBJECT_ERROR },
  );
