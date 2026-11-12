import type { Comment, Context, CreateRule, ESTree, Visitor } from "@oxlint/plugins";

/** The comment fields rules read; `range` is included because `report` needs it on a comment node. */
export type RuleComment = Pick<Comment, "type" | "value" | "start" | "end" | "range">;

/** The members of oxlint's `Context` rules read, so a test can build one whole with no cast. */
export type RuleContext = Pick<Context, "cwd" | "filename" | "options" | "report"> & {
  /** The parts of oxlint's `SourceCode` rules read; methods, so oxlint's real `SourceCode` assigns to it. */
  sourceCode: {
    text: string;
    getAllComments(): readonly RuleComment[];
    getCommentsBefore(node: ESTree.Node): readonly RuleComment[];
    getCommentsAfter(node: ESTree.Node): readonly RuleComment[];
  };
};

/** An oxlint rule whose `create` reads only `RuleContext`. */
export type RepoRule = Omit<CreateRule, "create"> & { create: (context: RuleContext) => Visitor };
