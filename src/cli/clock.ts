/**
 * The CLI's view of time.
 *
 * `Clock` is the same injected time source the audit log uses (re-exported so
 * the CLI has one type, not two); `SystemClock` is the production adapter.
 */

import type { Clock } from "../opencode/audit-log.ts";

export type { Clock };

/** The production `Clock`. */
export class SystemClock implements Clock {
    now(): Date {
        return new Date();
    }
}
