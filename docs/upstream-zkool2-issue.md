First `cargo build --features graphql --bin zkool_graphql` spends most of its fetch time cloning the full nymtech/nym history

**Context:** building `zkool_graphql` from source at the Zcash Free Society Hack (Mumbai, 4 Nov 2026) for [Hisaab](https://github.com/nikhil-pn/hisaab), a viewing-key bookkeeping tool that runs on zkool_graphql. Thanks for zkool: the GraphQL server, UIVK import and the `incoming: true` export made the project possible in one evening.

**What happened**

- The workspace `[patch.crates-io]` points `nym-smolmix`, `nym-sdk` and `nym-network-defaults` at `git = "https://github.com/nymtech/nym.git", rev = "88f21f0…"`. Cargo resolves patches even when the `nym` feature is off, so a `graphql`-only build still clones the whole nym repository. Cargo's built-in git fetch ran at about 0.5 MB/s on venue-grade internet and took over 10 minutes before compiling anything.
- Workaround that worked: `git fetch --depth 1 origin 88f21f017710f5e832b1489fcb273bd81e1e0786` (171 MB, 2 minutes), then point the three patches at local `path =` entries. `CARGO_NET_GIT_FETCH_WITH_CLI=true` also helped for the remaining git dependencies.
- `rust/rust-toolchain.toml` pins `1.99.0`, while its comment says 1.95.0 builds the workspace. Stable 1.96.0 built `zkool_graphql` cleanly here; the pin forces a toolchain download on first build.

**Suggestions**

1. Mention the prebuilt `zkool_graphql` release asset in the README's GraphQL section (many hackers didn't know it exists).
2. Optionally document the shallow-fetch workaround, or the `--locked` + `CARGO_NET_GIT_FETCH_WITH_CLI=true` combination.
3. Consider whether the toolchain pin can be relaxed to a minimum version for the GraphQL binary.

Environment: Ubuntu 24.04, x86_64, cargo 1.96.0, zkool2 `main` cloned 4 Nov 2026 (release v6.36.0).
