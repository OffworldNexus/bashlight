import { describe, expect, test } from "bun:test";

import { Parser } from "../../src/syntax/parser.ts";
import { createSourceDocument } from "../../src/syntax/source.ts";

describe("source documents", () => {
    test("a plain document has no parent", () => {
        const doc = createSourceDocument("echo hi");
        expect(doc.text).toBe("echo hi");
        expect(doc.parent).toBeUndefined();
    });

    test("a nested document links back to its origin", () => {
        const outer = createSourceDocument("bash -c 'echo hi'");
        const inner = createSourceDocument("echo hi", {
            doc: outer,
            span: { start: 9, end: 16 },
        });
        expect(inner.parent?.doc).toBe(outer);
        expect(inner.parent?.span).toEqual({ start: 9, end: 16 });
    });

    test("all spans are offsets into the document text", () => {
        const text = "echo $x";
        const doc = createSourceDocument(text);
        const result = new Parser().parse(doc);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(
                doc.text.slice(result.script.span.start, result.script.span.end),
            ).toBe(text);
        }
    });
});
