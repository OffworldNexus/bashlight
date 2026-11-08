/**
 * ESLint flat config: JS → TS type-checked → SonarJS → prettier, plus import
 * sorting. Formatting itself is prettier's job.
 */
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
    {
        ignores: [
            "node_modules",
            "corpus",
            "dist",
            "site",
            ".opencode",
            "bench/projects",
            "bench/runs",
            "bench/results",
            "bench/.cache",
        ],
    },
    js.configs.recommended,
    ...ts.configs.recommendedTypeChecked,
    sonarjs.configs.recommended,
    prettier,
    {
        languageOptions: {
            globals: { ...globals.node },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: { "simple-import-sort": simpleImportSort },
        rules: {
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "no-plusplus": "error",
            curly: "error",
            "no-var": "error",
            "prefer-const": "error",
        },
    },
    {
        files: ["**/*.js"],
        ...ts.configs.disableTypeChecked,
    },
);
