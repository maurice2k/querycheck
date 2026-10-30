.PHONY: test test-all test-20 test-22 test-24 types bench build

test: test-all

test-all:
	@$(MAKE) test-20; $(MAKE) test-22; $(MAKE) test-24

test-20:
	@docker compose run --rm node20 npx jest

test-22:
	@docker compose run --rm node22 npx jest

test-24:
	@docker compose run --rm node24 npx jest

types:
	docker compose run --rm node24 npx tsc -p tsconfig.json

bench:
	@git show 1.1.2:src/querycheck.js > bench/.querycheck-1.x.js
	docker compose run --rm node24 node bench/bench.js

build:
	docker compose build
