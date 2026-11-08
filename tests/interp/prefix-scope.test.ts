import { describe, expect, test } from "bun:test";

import { createInterpreter, type Invocation } from "../../src/interp/index.ts";

const INITIAL = {
    cwd: "/w",
    variables: { HOME: "/home/user", PATH: "/usr/bin:/bin" },
    complete: true,
};

function first(command: string): Invocation | undefined {
    return createInterpreter().interpret(command, INITIAL).invocations[0];
}

describe("prefix assignment scope", () => {
    test("A=1 echo $A: the word expansion does not see the prefix", () => {
        const invocation = first("A=1 echo $A");
        expect(invocation?.argv.map((arg) => arg.value)).toEqual(["echo"]);
        expect(invocation?.env.lookup("A")).toEqual({ kind: "set", value: "1" });
    });

    test("a quoted prefix variable expands to the outer (unset) value", () => {
        const invocation = first('A=1 echo "$A"');
        expect(invocation?.argv.map((arg) => arg.value)).toEqual(["echo", ""]);
    });

    test("P=python $P a.py: argv is [a.py] and the command sees P", () => {
        const invocation = first("P=python $P a.py");
        expect(invocation?.argv.map((arg) => arg.value)).toEqual(["a.py"]);
        expect(invocation?.env.lookup("P")).toEqual({
            kind: "set",
            value: "python",
        });
    });
});
