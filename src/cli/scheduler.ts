/**
 * The CLI's timer seam.
 *
 * Follow loops sleep between polls; tests inject a scheduler that appends to the
 * log before resolving, so the whole watch command is deterministic. Sleeping is
 * abortable: a follow loop wakes up when the process is asked to stop.
 */

/** Waits without blocking the event loop. */
export interface Scheduler {
    /** Resolves after `milliseconds`, or as soon as `signal` aborts. */
    sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

/** The production `Scheduler`, backed by `setTimeout`. */
export class SystemScheduler implements Scheduler {
    sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
        return new Promise((resolve) => {
            if (signal.aborted) {
                resolve();
                return;
            }
            const finish = (): void => {
                signal.removeEventListener("abort", finish);
                resolve();
            };
            const timer = setTimeout(finish, milliseconds);
            signal.addEventListener(
                "abort",
                () => {
                    clearTimeout(timer);
                    finish();
                },
                { once: true },
            );
        });
    }
}
