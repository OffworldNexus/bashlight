/**
 * The real deadline behind {@link RuleDeadline}: a `setTimeout`-backed budget
 * for importing a rule file and evaluating its factories.
 *
 * The timer is cleared as soon as the work settles, so a normal load never
 * delays process exit. This is an adapter (it owns a timer and the clock), which
 * is why it lives outside the pure `rules/custom` module.
 */

import { type RuleDeadline, RuleDeadlineError } from "../rules/custom/index.ts";

export class PromiseRuleDeadline implements RuleDeadline {
    limit<T>(work: Promise<T>, milliseconds: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new RuleDeadlineError(`budget of ${String(milliseconds)}ms`));
            }, milliseconds);
            work.then(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (error: unknown) => {
                    clearTimeout(timer);
                    reject(error instanceof Error ? error : new Error(String(error)));
                },
            );
        });
    }
}
