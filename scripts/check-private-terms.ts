/**
 * Fails when a staged (or, with --all, tracked) file contains a private term.
 *
 * The terms live outside the repository, one per line, in
 * ~/.config/bashlight/private-terms.txt (override with BASHLIGHT_PRIVATE_TERMS).
 * The script itself must never contain any of them. Used as a git pre-commit
 * hook: `ln -s ../../scripts/pre-commit .git/hooks/pre-commit`.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

class PrivateTermChecker {
    constructor(private readonly terms: readonly string[]) {}

    findings(path: string, content: string): string[] {
        const lower = content.toLowerCase();
        return this.terms
            .filter((term) => lower.includes(term.toLowerCase()))
            .map((term) => `${path}: contains private term "${term}"`);
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
    const findings = gitFiles(process.argv.includes("--all"))
        .filter((path) => existsSync(path))
        .flatMap((path) => checker.findings(path, readFileSync(path, "utf8")));
    for (const finding of findings) {
        console.error(finding);
    }
    return findings.length === 0 ? 0 : 1;
}

process.exit(main());
