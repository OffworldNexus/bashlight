.PHONY: help clean format lint typecheck test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

clean: format lint typecheck ## Format, lint and type-check everything

format: ## Format (prettier) and auto-fix lint issues (eslint)
	bunx prettier --write .
	bunx eslint --fix .

lint: ## Check format and lint without modifying files
	bunx prettier --check .
	bunx eslint .

typecheck: ## Type-check with tsc
	bunx tsc --noEmit

test: ## Run the test suite
	bun test
