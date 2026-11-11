import type { CheckRepo } from "./check-repo.ts";
import { useCheckRepo } from "./check-repo.ts";
import { useStart, type MainFakes, type Written } from "./main-kit.ts";

/** Per test: `start`'s output in `written` and a temp repo to run `repo check` in. */
export function useMainCheckRepo(fakes: MainFakes): { repo: CheckRepo; written: Written } {
  const written = useStart(fakes);
  return { repo: useCheckRepo(fakes, written), written };
}
