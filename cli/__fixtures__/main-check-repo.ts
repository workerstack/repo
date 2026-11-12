import type { CheckRepo } from "./check-repo.ts";
import { useCheckRepo } from "./check-repo.ts";
import { mainFakes, useStart, type MainFakes, type Written } from "./main-kit.ts";

/** Per test: the fakes `start` runs on, its output in `written` and a temp repo to run `repo check` in. */
export function useMainCheckRepo(): { fakes: MainFakes; repo: CheckRepo; written: Written } {
  const fakes = mainFakes();
  const written = useStart(fakes);
  return { fakes, repo: useCheckRepo(fakes, written), written };
}
