/* eslint-disable sonarjs/function-return-type */
/**
 * Rewrites npm/pnpm/yarn/bun commands to the manager a Node project actually
 * uses: `npm install -D x` → `pnpm add -D x`, `npx x` → `pnpm exec x` or
 * `pnpm dlx x` depending on whether the binary is declared. It also routes a
 * script whose shebang runs a declared Node tool (`./bin/cli` with
 * `#!/usr/bin/env tsx`) through the project's own exec runner.
 */
import type { NodeToolchain } from "../../project/index.ts";
import {
    type ExecKind,
    type NodeAction,
    nodeDialect,
    nodeScriptTool,
    parseNodeCommand,
} from "../knowledge/node-command-line.ts";
import { resolveScript } from "../knowledge/script-resolver.ts";
import type { CommandCall, Rule, RuleContext, Verdict } from "../rule.ts";
import { argsFrom, keep, replace, text } from "../verdict.ts";

export class NodeManagerRule implements Rule {
    readonly id = "node-manager";
    readonly scope = "local";

    inspect(call: CommandCall, context: RuleContext): Verdict {
        if (context.cwd === undefined) {
            return keep();
        }
        const project = context.project.node(context.cwd);
        if (project === undefined) {
            return keep();
        }
        const command = parseNodeCommand(call.argv);
        if (command === undefined) {
            return this.script(call, project, context);
        }
        if (command.manager === project.manager) {
            return keep();
        }
        const action = command.action;
        if (action.kind === "global" || action.kind === "other") {
            return keep();
        }
        const exec = this.execKind(call, action, project);
        if (action.kind === "exec" && exec === undefined) {
            return keep();
        }
        const argv = nodeDialect(project.manager).render(command, {
            exec: exec ?? "installed",
            yarnBerry: project.yarnBerry,
        });
        if (argv.length === 0) {
            return keep();
        }
        return replace(
            argv,
            `use \`${project.manager}\` instead of \`${command.manager}\``,
        );
    }

    /** Whether an `exec` binary is installed; `undefined` when unknown. */
    private execKind(
        call: CommandCall,
        action: NodeAction,
        project: NodeToolchain,
    ): ExecKind | undefined {
        if (action.kind !== "exec") {
            return "installed";
        }
        const binary = call.argv[action.binary]?.value;
        if (binary === undefined) {
            return undefined;
        }
        return project.declares(binary) ? "installed" : "download";
    }

    /** Runs a Node-tool shebang script through the project's exec runner. */
    private script(
        call: CommandCall,
        project: NodeToolchain,
        context: RuleContext,
    ): Verdict {
        const script = resolveScript(call, context);
        if (script === undefined) {
            return keep();
        }
        const tool = nodeScriptTool(script.shebang);
        if (tool === undefined || !project.declares(tool)) {
            return keep();
        }
        const prefix = nodeDialect(project.manager).execPrefix(
            "installed",
            project.yarnBerry,
            false,
        );
        if (prefix === undefined) {
            return keep();
        }
        return replace(
            [...text(...prefix), ...text(tool), ...argsFrom(call.argv, 0)],
            `run ${tool} through ${project.manager}`,
        );
    }
}
