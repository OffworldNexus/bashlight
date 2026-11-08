/**
 * The v1 rule set, in priority order. The order matters: earlier rules decide
 * first each round, so `pip-to-manager` runs before `python-runner`, and
 * `bare-python` only ever sees commands without a project.
 */
import type { Rule } from "../rule.ts";
import { BarePythonRule } from "./bare-python.ts";
import { NodeManagerRule } from "./node-manager.ts";
import { PipToManagerRule } from "./pip-to-manager.ts";
import { PythonRunnerRule } from "./python-runner.ts";
import { RedundantRunnerRule } from "./redundant-runner.ts";

export { BarePythonRule } from "./bare-python.ts";
export { NodeManagerRule } from "./node-manager.ts";
export { PipToManagerRule } from "./pip-to-manager.ts";
export { PythonRunnerRule } from "./python-runner.ts";
export { RedundantRunnerRule } from "./redundant-runner.ts";

/** Builds the built-in rules in their canonical priority order. */
export function createBuiltinRules(): Rule[] {
    return [
        new RedundantRunnerRule(),
        new PipToManagerRule(),
        new BarePythonRule(),
        new PythonRunnerRule(),
        new NodeManagerRule(),
    ];
}
