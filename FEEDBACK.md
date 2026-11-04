# Feedback

For each item: what we tried, what happened, what we expected.

## Faucet
(more added during the real-chain run)

## Node or indexer (lightwalletd, Zebra, Zaino)
(more added during the real-chain run)

## SDK or wallet tool (zkool2 v6.36.0, `zkool_graphql`)
- **Toolchain on first build.** Tried: `cargo build` in `zkool2/rust` as the brief says. Happened: `rust/` pins a Rust toolchain (1.99.0), so the first build also downloads a new toolchain before compiling. Expected: a note that the first build includes a toolchain download.
- **Prebuilt binary not mentioned.** Tried: followed the build-from-source steps (about 30 minutes). Happened: release v6.36.0 of zkool2 ships a prebuilt `zkool_graphql` asset, but the brief only documents building from source. Expected: one line pointing to the release asset, which would save every team the build.
- **Bind address not in the documented command.** Tried: the documented run command with `--allow-unauthenticated`, which exposes seeds. Happened: `--bind-address` exists (`src/graphql-cli.rs`) but is not in the command. Expected: the documented command to include `--bind-address 127.0.0.1` wherever `--allow-unauthenticated` is used. We use it in `scripts/zkool-up.sh`.

## Wallet
(more added during the real-chain run)

## Docs
- See the two zkool items above (prebuilt binary, bind address): both are documentation gaps.

## Other
(more added during the real-chain run)
