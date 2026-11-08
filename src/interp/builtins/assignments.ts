/* eslint-disable sonarjs/cognitive-complexity */
/**
 * The assignment builtins: `export`, `declare`, `typeset`, `local`,
 * `readonly`. They set variables (recording a binding so a later `$VAR` can be
 * folded back into the assignment) and toggle the exported flag. `local` and
 * `declare`/`typeset` (without `-g`) declare function-locals that are restored
 * when the function returns.
 */

import { parseAssignmentWord } from "../../syntax/index.ts";
import type { Builtin, BuiltinInput } from "./types.ts";

const NAMES = ["export", "declare", "typeset", "local", "readonly"];

export class AssignmentBuiltin implements Builtin {
    readonly names = NAMES;

    apply(input: BuiltinInput): void {
        const { argv, scope, store, doc } = input;
        const name = input.name;
        const flags = new Set<string>();
        let index = 1;
        for (; index < argv.length; index += 1) {
            const value = argv[index]?.value;
            if (value === undefined) {
                break;
            }
            if (value === "--") {
                index += 1;
                break;
            }
            if (value.startsWith("-") && value.length > 1) {
                for (const ch of value.slice(1)) {
                    flags.add(ch);
                }
                continue;
            }
            break;
        }
        const unexport = name === "export" && flags.has("n");
        const exported = (name === "export" || flags.has("x")) && !unexport;
        const array = flags.has("a") || flags.has("A");
        const nameref = flags.has("n") && name !== "export";
        const localLike =
            name === "local" ||
            ((name === "declare" || name === "typeset") && !flags.has("g"));

        for (const arg of argv.slice(index)) {
            const parsed = parseAssignmentWord(arg.word);
            if (parsed !== undefined) {
                if (localLike) {
                    store.declareLocal(scope, parsed.name);
                }
                if (array || nameref) {
                    store.setUnknown(scope, parsed.name, { exported });
                    continue;
                }
                const expanded = store.expandAssignmentWord(arg.word, doc, scope);
                store.setExpanded(scope, parsed.name, expanded.fragments, {
                    exported,
                    assignment: { kind: "word", word: arg.word, parsed },
                });
                continue;
            }
            const varName = arg.value;
            if (varName === undefined) {
                continue;
            }
            if (unexport) {
                store.markExported(scope, varName, false);
                continue;
            }
            if (localLike) {
                store.declareLocal(scope, varName);
            }
            if (name === "export") {
                store.markExported(scope, varName, true);
                continue;
            }
            if (scope.env.entry(varName) === undefined) {
                store.setString(scope, varName, "", { exported });
            }
        }
    }
}
