import { describe, expect, test } from "bun:test";

import { SessionDirectoryCache } from "../../src/opencode/session-directory-cache.ts";
import { RecordingLogger } from "./fakes.ts";

const FALLBACK = "/w/project";

function cache(
    lookup: (sessionID: string) => Promise<string>,
    maxEntries?: number,
): { cache: SessionDirectoryCache; logger: RecordingLogger } {
    const logger = new RecordingLogger();
    return {
        cache: new SessionDirectoryCache({
            lookup,
            fallback: FALLBACK,
            logger,
            ...(maxEntries === undefined ? {} : { maxEntries }),
        }),
        logger,
    };
}

describe("SessionDirectoryCache", () => {
    test("calls the lookup once and reuses the result", async () => {
        const seen: string[] = [];
        const { cache: directories } = cache((sessionID) => {
            seen.push(sessionID);
            return Promise.resolve(`/d/${sessionID}`);
        });

        expect(await directories.directoryFor("a")).toBe("/d/a");
        expect(await directories.directoryFor("a")).toBe("/d/a");
        expect(seen).toEqual(["a"]);
    });

    test("does not cache a failure, then retries and succeeds", async () => {
        let calls = 0;
        const { cache: directories, logger } = cache(() => {
            calls += 1;
            return calls === 1
                ? Promise.reject(new Error("session unreadable"))
                : Promise.resolve("/d/a");
        });

        expect(await directories.directoryFor("a")).toBe(FALLBACK);
        expect(logger.errors).toHaveLength(1);
        expect(calls).toBe(1);

        expect(await directories.directoryFor("a")).toBe("/d/a");
        expect(calls).toBe(2);

        // The successful lookup is now cached.
        expect(await directories.directoryFor("a")).toBe("/d/a");
        expect(calls).toBe(2);
    });

    test("evicts the least recently used entry", async () => {
        const seen: string[] = [];
        const { cache: directories } = cache((sessionID) => {
            seen.push(sessionID);
            return Promise.resolve(`/d/${sessionID}`);
        }, 2);

        await directories.directoryFor("a");
        await directories.directoryFor("b");
        await directories.directoryFor("a"); // touch `a`, making `b` the LRU
        await directories.directoryFor("c"); // evicts `b`
        await directories.directoryFor("b"); // must be looked up again

        expect(seen).toEqual(["a", "b", "c", "b"]);
    });
});
