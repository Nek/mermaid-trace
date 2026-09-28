.PHONY: build test typecheck snapshots-update preview native-build native-test

build: native-build
	cd mermaid-trace-ts && corepack pnpm run build

test: native-test
	cd mermaid-trace-ts && corepack pnpm test

typecheck:
	cd mermaid-trace-ts && corepack pnpm run typecheck

snapshots-update:
	cd mermaid-trace-ts && corepack pnpm snapshots:update

preview: build
	node mermaid-trace-ts/dist/src/cli.js $(ARGS)

native-build:
	bash mermaid-trace-rs/bootstrap.sh
	cargo build --manifest-path mermaid-trace-rs/Cargo.toml --locked

native-test: native-build
	cargo test --manifest-path mermaid-trace-rs/Cargo.toml --locked
