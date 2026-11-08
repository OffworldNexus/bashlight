/**
 * Public surface of the `syntax` module.
 */

export type { AssignmentWord } from "./assignment-parser.ts";
export { parseAssignmentWord } from "./assignment-parser.ts";
export * from "./ast.ts";
export type { ParseError } from "./errors.ts";
export { Parser } from "./parser.ts";
export type { NestedOrigin, SourceDocument, Span } from "./source.ts";
export { createSourceDocument } from "./source.ts";
