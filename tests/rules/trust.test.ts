import { describe, expect, test } from "bun:test";

import { JsonTrustStore } from "../../src/rules/custom/index.ts";
import { MemoryTrustStorage } from "../support/rules.ts";

describe("JsonTrustStore", () => {
    test("trusts nothing by default", () => {
        const store = new JsonTrustStore(new MemoryTrustStorage());
        expect(store.isTrusted("/w")).toBe(false);
        expect(store.list()).toEqual([]);
    });

    test("trusts a directory and everything under it", () => {
        const store = new JsonTrustStore(new MemoryTrustStorage());
        store.trust("/w/../w/project");
        expect(store.list()).toEqual(["/w/project"]);
        expect(store.isTrusted("/w/project")).toBe(true);
        expect(store.isTrusted("/w/project/sub")).toBe(true);
        expect(store.isTrusted("/elsewhere")).toBe(false);
    });

    test("does not trust a parent of a trusted directory", () => {
        const store = new JsonTrustStore(new MemoryTrustStorage('["/w/project"]'));
        expect(store.isTrusted("/w")).toBe(false);
    });

    test("untrust removes only that root", () => {
        const store = new JsonTrustStore(new MemoryTrustStorage('["/a","/b"]'));
        store.untrust("/a");
        expect(store.list()).toEqual(["/b"]);
    });

    test("ignores a malformed trust file", () => {
        expect(
            new JsonTrustStore(new MemoryTrustStorage("not json")).isTrusted("/w"),
        ).toBe(false);
        expect(new JsonTrustStore(new MemoryTrustStorage('{"a":1}')).list()).toEqual(
            [],
        );
    });
});
