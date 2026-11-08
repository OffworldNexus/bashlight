import { describe, expect, test } from "bun:test";

import { expectSpans, parseOk } from "./helpers.ts";

describe("command lists", () => {
    test("sequence with semicolons and newlines", () => {
        const script = parseOk("a; b\nc");
        expect(script.body.items.map((i) => i.separator)).toEqual([
            ";",
            "\n",
            undefined,
        ]);
        expect(script.body.items).toHaveLength(3);
    });

    test("background job with &", () => {
        const script = parseOk("sleep 1 & echo done");
        expect(script.body.items[0]?.separator).toBe("&");
        expect(script.body.items).toHaveLength(2);
    });

    test("and-or chains", () => {
        const script = parseOk("a && b || c");
        const andOr = script.body.items[0]?.command;
        expect(andOr?.rest.map((link) => link.operator)).toEqual(["&&", "||"]);
        expect(script.body.items).toHaveLength(1);
    });

    test("pipelines with | and |&", () => {
        const pipeline = parseOk("a | b |& c").body.items[0]?.command.first;
        expect(pipeline?.members.map((m) => m.pipe)).toEqual(["|", "|&", undefined]);
    });

    test("negation and time", () => {
        const negated = parseOk("! false").body.items[0]?.command.first;
        expect(negated?.negated).toBe(true);
        const timed = parseOk("time -p sleep 1").body.items[0]?.command.first;
        expect(timed?.time?.posix).toBe(true);
        expect(timed?.time?.span).toEqual({ start: 0, end: 7 });
    });

    test("time without -p, repeated negation, and flag-only pipelines", () => {
        const timed = parseOk("time sleep 1").body.items[0]?.command.first;
        expect(timed?.time?.posix).toBe(false);
        const repeated = parseOk("! ! false").body.items[0]?.command.first;
        expect(repeated?.negated).toBe(true);
        const timeOnly = parseOk("time").body.items[0]?.command.first;
        expect(timeOnly?.time).not.toBeUndefined();
        expect(timeOnly?.members).toHaveLength(0);
        const bangOnly = parseOk("!").body.items[0]?.command.first;
        expect(bangOnly?.negated).toBe(true);
        expect(bangOnly?.members).toHaveLength(0);
        expect(parseOk("time\necho hi").body.items).toHaveLength(2);
    });

    test("trailing comment is recorded and ends the line", () => {
        const script = parseOk("echo hi # a comment\necho bye");
        expect(script.comments).toHaveLength(1);
        expect(script.comments[0]).toEqual({ start: 8, end: 19 });
        expect(script.body.items).toHaveLength(2);
    });

    test("leading and standalone comments", () => {
        const script = parseOk("# one\n# two\necho hi");
        expect(script.comments).toHaveLength(2);
        expect(script.body.items).toHaveLength(1);
    });

    test("hash inside a word is not a comment", () => {
        const script = parseOk("echo a#b");
        expect(script.comments).toHaveLength(0);
        expect(script.body.items[0]?.command.first.members[0]?.command.kind).toBe(
            "SimpleCommand",
        );
    });

    test("line continuation joins a command", () => {
        const script = parseOk("echo a \\\n  b");
        expect(script.body.items).toHaveLength(1);
        expectSpans("echo a \\\n  b");
    });

    test("empty input parses to an empty body", () => {
        const script = parseOk("");
        expect(script.body.items).toHaveLength(0);
        expect(script.span).toEqual({ start: 0, end: 0 });
    });
});

describe("compound and simple command spans", () => {
    test("simple command span covers its elements", () => {
        const script = parseOk("foo a > out");
        const command = script.body.items[0]?.command.first.members[0]?.command;
        expect(command?.span).toEqual({ start: 0, end: 11 });
    });
});
