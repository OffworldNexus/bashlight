/**
 * Fails when a staged (or, with --all, tracked) file contains a private term.
 *
 * The terms live outside the repository, one per line, in
 * ~/.config/bashlight/private-terms.txt (override with BASHLIGHT_PRIVATE_TERMS).
 * The script itself must never contain any of them. Used as a git pre-commit
 * hook: `ln -s ../../scripts/pre-commit .git/hooks/pre-commit`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Matches each term as a whole word (letters and digits around it end the
 * match), case-insensitively, so short terms don't flag every identifier that
 * happens to contain them.
 */
class PrivateTermChecker {
    private readonly patterns: readonly { term: string; regex: RegExp }[];

    constructor(terms: readonly string[]) {
        this.patterns = terms.map((term) => ({
            term,
            regex: new RegExp(
                `(?<![\\p{L}\\p{N}])${RegExp.escape(term)}(?![\\p{L}\\p{N}])`,
                "iu",
            ),
        }));
    }

    findings(path: string, content: string): string[] {
        return this.patterns
            .filter(({ regex }) => regex.test(content))
            .map(({ term }) => `${path}: contains private term "${term}"`);
    }
}

function loadTerms(path: string): string[] {
    return readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function gitFiles(all: boolean): string[] {
    const args = all
        ? ["ls-files"]
        : ["diff", "--cached", "--name-only", "--diff-filter=ACMR"];
    const result = Bun.spawnSync(["git", ...args]);
    return result.stdout
        .toString()
        .split("\n")
        .filter((line) => line.length > 0);
}

function main(): number {
    const termsPath =
        process.env["BASHLIGHT_PRIVATE_TERMS"] ??
        join(homedir(), ".config", "bashlight", "private-terms.txt");
    if (!existsSync(termsPath)) {
        console.error(`check-private-terms: no terms file at ${termsPath}`);
        return 1;
    }
    const checker = new PrivateTermChecker(loadTerms(termsPath));
    const findings = gitFiles(process.argv.slice(2).some((arg) => arg === "--all"))
        .filter((path) => existsSync(path) && statSync(path).isFile())
        .flatMap((path) => checker.findings(path, readFileSync(path, "utf8")));
    for (const finding of findings) {
        console.error(finding);
    }
    return findings.length === 0 ? 0 : 1;
}

process.exit(main());
