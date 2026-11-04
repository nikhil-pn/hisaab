# Brief for every agent working on Hisaab

- Deadline: submissions close **Thu 5 Nov 00:00 IST**. Check `TZ=Asia/Kolkata date` often. Report back early rather than late.
- Spec: `PLAN.md`. Zcash facts and the zkool_graphql GraphQL reference: `AGENTS.md` (organiser's brief — it overrides training data: testnet only, NU7, Ironwood pool, `https://testnet.zec.rocks:443`, explorer `https://zexplorer.app/testnet/tx/<txid>`).
- zkool_graphql source (for exact GraphQL types) is at `~/hackathons/freesociety-nikhil/zkool2/rust/src/graphql/`.
- Runtime: Node 24 at `~/.nvm/versions/node/v24.14.1/bin/node` (system `node` is 18 — don't use it). **Zero npm dependencies**: use built-in `fetch`, `node:http`, `node:test`, `node:crypto`. Plain ESM JavaScript with JSDoc.
- Never print, log or commit seed phrases or spending keys. Viewing keys (`uviewtest…`) are OK on the server, labelled. Secrets/state live in git-ignored `.env` / `data/` (mode 600).
- Every server binds to `127.0.0.1` and rejects cross-origin POSTs.
- Honesty rule: never present a mock or fixture as real. Tests use a mock zkool server; the real path uses a real zkool_graphql.
- Do NOT git commit or push; the coordinator does.
- Final report (≤15 lines): what works, exact test commands + results, what's real vs mocked, blockers.
