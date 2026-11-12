import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

/** A comment as eslint's `SourceCode` hands it to a rule; positions come from `range`. */
export type RuleComment = TSESTree.Comment;

/** A repo lint rule: a typescript-eslint rule module, which eslint's `Linter` and oxlint both run. */
export type RepoRule<Ids extends string = string, Options extends readonly unknown[] = []> = TSESLint.RuleModule<
  Ids,
  Options
>;
