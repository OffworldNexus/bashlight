/**
 * The projected-cost guard for a benchmark matrix.
 *
 * The runner opts into a spending cap (`--max-cost`). Before starting each run
 * it asks this guard whether the projection — the cost already spent plus the
 * mean cost of the runs completed so far, times the runs that would be in
 * flight — would cross the cap. The first runs are always allowed (there is no
 * mean yet), so a cap only ever stops work once there is evidence of what a
 * run costs.
 */

export interface CostGuardResult {
    readonly stop: boolean;
    readonly spent: number;
    readonly mean: number;
    readonly projection: number;
}

/** Tracks spend across a matrix and projects the next run's cost. */
export class CostGuard {
    private spentAmount = 0;
    private completedCount = 0;

    constructor(private readonly maxCost: number) {}

    /** Records the cost of a run that has finished. */
    record(costUsd: number): void {
        this.spentAmount += costUsd;
        this.completedCount += 1;
    }

    /** Total cost of every completed run. */
    get spent(): number {
        return this.spentAmount;
    }

    /** Mean cost of the completed runs, or 0 before the first one. */
    get mean(): number {
        return this.completedCount === 0 ? 0 : this.spentAmount / this.completedCount;
    }

    /**
     * Whether the runner should stop before starting another run. `inFlight` is
     * the number of runs already executing: the projection reserves the cost of
     * those plus the one about to start, so a parallel matrix still respects the
     * cap. With no completed run there is no mean, so the run proceeds.
     */
    check(inFlight = 0): CostGuardResult {
        const reserved = inFlight + 1;
        const projection =
            this.completedCount === 0
                ? this.spentAmount
                : this.spentAmount + this.mean * reserved;
        return {
            stop: this.completedCount > 0 && projection > this.maxCost,
            spent: this.spentAmount,
            mean: this.mean,
            projection,
        };
    }
}
