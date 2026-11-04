Draft reply for the Zcash Community Forum. Post it in "Is anyone actually using viewing keys for business accounting?" (https://forum.zcashcommunity.com/t/is-anyone-actually-using-viewing-keys-for-business-accounting/56300) or "What are you building on Zcash?" (https://forum.zcashcommunity.com/t/what-are-you-building-on-zcash/55172).

---

We tried to answer "the boring middle" at the Free Society Hack in Mumbai tonight: **Hisaab** (https://github.com/nikhil-pn/hisaab).

- Invoices carry a code in the encrypted memo of a ZIP 321 link.
- A watch-only zkool_graphql account built from an **incoming viewing key** (UIVK, not the full UFVK) matches payments to invoices: seen in the mempool, then paid after 1 confirmation.
- At year end it builds a pack for the accountant: ledger CSV/JSON for the Indian financial year (Apr–Mar, which Schedule VDA uses), one receipt per payment, a sha256 manifest, and a record that the key can't spend.

It runs on testnet today (first payment: d78fd57ae683f7ac1055e4c6b8133db2e5350cce2306ae15a0ab8e5dd5ac4541). Zero-dependency Node; the library part is importable.

Two things we learned that might help others:
1. `unifiedFullViewingKey(idAccount, incoming: true)` in zkool gives the UIVK. It's the narrowest key you can hand someone: income only, no spends, no change.
2. A handed-out key can't be recalled, so the next step is receipts a CA can check without holding the key at all.

If you keep books for a shielded-ZEC business, or you're a CA who has been handed a viewing key, I'd like to hear what your export is missing.
