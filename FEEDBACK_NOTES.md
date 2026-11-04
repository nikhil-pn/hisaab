# Raw friction notes (kept from the first error; FEEDBACK.md is written from these)

- 20:50 zkool2: `rust/` pins a toolchain (1.99.0) so the first `cargo build` also downloads a new Rust toolchain before compiling.
- 20:50 zkool2: release v6.36.0 ships a prebuilt `zkool_graphql` asset, but AGENTS.md only documents building from source (~30 min). One line in the brief would save every team the build.
- 21:00 zkool_graphql binds where? `--bind-address` exists (src/graphql-cli.rs) but isn't in the organisers' run command; with `--allow-unauthenticated` (which exposes seeds) it should be in the documented command.
