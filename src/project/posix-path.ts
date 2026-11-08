/**
 * Minimal pure POSIX path helpers.
 *
 * The project inspector only ever receives absolute POSIX paths, so the full
 * `node:path` machinery is unnecessary and would pull a Node builtin into the
 * otherwise pure inspection core.
 */

/** Removes trailing slashes (except on the root). */
export function normalize(path: string): string {
    if (path === "") {
        return "/";
    }
    let end = path.length;
    while (end > 1 && path.charAt(end - 1) === "/") {
        end -= 1;
    }
    return path.slice(0, end);
}

/** Parent directory of an absolute path; the parent of "/" is "/". */
export function dirname(path: string): string {
    const normalized = normalize(path);
    const index = normalized.lastIndexOf("/");
    if (index <= 0) {
        return "/";
    }
    return normalized.slice(0, index);
}

/** Joins path segments, POSIX-style. */
export function join(base: string, ...segments: string[]): string {
    let result = base;
    for (const segment of segments) {
        if (segment === "") {
            continue;
        }
        if (segment.startsWith("/")) {
            result = segment;
        } else if (result === "") {
            result = segment;
        } else if (result === "/") {
            result = `/${segment}`;
        } else {
            result = `${normalize(result)}/${segment}`;
        }
    }
    return result === "" ? "/" : result;
}

/**
 * `dir` followed by all its ancestors, innermost first, ending with "/".
 */
export function selfAndAncestors(dir: string): readonly string[] {
    const chain: string[] = [];
    let current = normalize(dir);
    for (;;) {
        chain.push(current);
        if (current === "/") {
            break;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return chain;
}

/**
 * The first of `dir` and its ancestors (innermost first) satisfying
 * `predicate`, or `undefined` when none does.
 */
export function nearestSelfOrAncestor(
    dir: string,
    predicate: (candidate: string) => boolean,
): string | undefined {
    return selfAndAncestors(dir).find((candidate) => predicate(candidate));
}
