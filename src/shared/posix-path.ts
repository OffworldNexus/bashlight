/**
 * Pure POSIX path helpers shared by every module.
 *
 * This is the only leaf module the rest of the code base may depend on
 * (`syntax` ← `interp` ← `rules` ← …): it has no imports and pulls in no Node
 * builtin, so it stays safe for the otherwise pure core. Paths are absolute
 * unless stated otherwise.
 */

/** Removes trailing slashes (except on the root); does not resolve `..`. */
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

/** Collapses `.`/`..` segments and makes `path` absolute. */
export function normalizeAbsolute(path: string): string {
    const segments: string[] = [];
    for (const segment of path.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return `/${segments.join("/")}`;
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

/** Last path segment. */
export function basename(path: string): string {
    const normalized = normalize(path);
    if (normalized === "/") {
        return "/";
    }
    return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/** Joins segments onto a base, POSIX-style. */
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

/** Resolves `path` against `cwd`; `undefined` when a relative cwd is unknown. */
export function resolve(cwd: string | undefined, path: string): string | undefined {
    return path.startsWith("/") ? normalizeAbsolute(path) : resolveRelative(cwd, path);
}

function resolveRelative(cwd: string | undefined, path: string): string | undefined {
    return cwd === undefined ? undefined : normalizeAbsolute(`${cwd}/${path}`);
}

/** Whether `child` is `parent` or below it. */
export function isInside(child: string, parent: string): boolean {
    const target = normalizeAbsolute(parent);
    if (target === "/") {
        return true;
    }
    const candidate = normalizeAbsolute(child);
    return candidate === target || candidate.startsWith(`${target}/`);
}

/** POSIX path of `to` relative to `from`; both absolute. */
export function relative(from: string, to: string): string {
    const fromParts = normalizeAbsolute(from)
        .split("/")
        .filter((part) => part !== "");
    const toParts = normalizeAbsolute(to)
        .split("/")
        .filter((part) => part !== "");
    let common = 0;
    while (
        common < fromParts.length &&
        common < toParts.length &&
        fromParts[common] === toParts[common]
    ) {
        common += 1;
    }
    const parts = [
        ...fromParts.slice(common).map(() => ".."),
        ...toParts.slice(common),
    ];
    return parts.length === 0 ? "." : parts.join("/");
}

/** `dir` followed by all its ancestors, innermost first, ending with "/". */
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
