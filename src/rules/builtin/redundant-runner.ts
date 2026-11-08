/* eslint-disable sonarjs/function-return-type */
/**
 * Collapses an immediately repeated runner prefix: `poetry run poetry run x`,
 * `uv run uv run x`, `npx npx x`, `pnpm exec pnpm exec x`… The parser's own
 * prefix lengths tell us where each runner prefix ends, so there is no separate
 * table of runner names here.
 */
import { parseNodeCommand } from "../knowledge/node-command-line.ts";
import { parsePythonCommand } from "../knowledge/python-command-line.ts";
import type { CommandCall, Rule, RuleContext, Verdict } from "../rule.ts";
import { argsFrom, keep, replace } from "../verdict.ts";

export class RedundantRunnerRule implements Rule {
    readonly id = "redundant-runner";
    readonly scope = "local";

    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (context.cwd === undefined) {
            return keep();
        }
        return this.python(call) ?? this.node(call) ?? keep();
    }

    private python(call: CommandCall): Verdict | undefined {
        const outer = parsePythonCommand(call.argv);
        if (outer === undefined || outer.runner.kind !== "manager") {
            return undefined;
        }
        const inner = parsePythonCommand(call.argv.slice(outer.runner.length));
        if (
            inner === undefined ||
            inner.runner.kind !== "manager" ||
            inner.runner.manager !== outer.runner.manager
        ) {
            return undefined;
        }
        const argv = [
            ...argsFrom(call.argv, 0).slice(0, outer.runner.length),
            ...argsFrom(call.argv, outer.runner.length + inner.runner.length),
        ];
        return replace(argv, `collapse repeated \`${outer.runner.manager} run\``);
    }

    private node(call: CommandCall): Verdict | undefined {
        const outer = parseNodeCommand(call.argv);
        if (outer === undefined || outer.action.kind !== "exec") {
            return undefined;
        }
        const executable = call.argv[0]?.value;
        const start = outer.action.binary;
        const inner = parseNodeCommand(call.argv.slice(start));
        if (
            inner === undefined ||
            inner.action.kind !== "exec" ||
            call.argv[start]?.value !== executable
        ) {
            return undefined;
        }
        const argv = [
            ...argsFrom(call.argv, 0).slice(0, start),
            ...argsFrom(call.argv, start + inner.action.binary),
        ];
        return replace(argv, `collapse repeated \`${executable}\``);
    }
}
