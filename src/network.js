// Network table. Testnet is the default and the scored path; mainnet is an
// optional, clearly-labelled, WATCH-ONLY mode (Hisaab never calls `pay` there).

/** Explorer URL templates, one place to fix them. `{txid}` is replaced. */
export const EXPLORER_TX = {
  test: 'https://zexplorer.app/testnet/tx/{txid}',
  main: 'https://zexplorer.app/tx/{txid}',
};

export const NETWORKS = {
  test: {
    id: 'test',
    label: 'TESTNET',
    chain: 'zcash-testnet',
    coin: 'TAZ',
    viewingKeys: { full: 'uviewtest1', incoming: 'uivktest1' },
    addresses: { unified: 'utest1', sapling: 'ztestsapling1' },
  },
  main: {
    id: 'main',
    label: 'MAINNET',
    chain: 'zcash-mainnet',
    coin: 'ZEC',
    viewingKeys: { full: 'uview1', incoming: 'uivk1' },
    addresses: { unified: 'u1', sapling: 'zs1' },
  },
};

/** @typedef {'test'|'main'} NetworkId */

/** @param {string|undefined|null} v @returns {NetworkId} */
export function parseNetwork(v) {
  const s = String(v ?? 'test').trim().toLowerCase();
  if (s === '' || s === 'test' || s === 'testnet') return 'test';
  if (s === 'main' || s === 'mainnet') return 'main';
  throw new Error(`HISAAB_NETWORK must be "test" or "main", got "${v}"`);
}

/** @param {NetworkId} [net] */
export function network(net = 'test') {
  return NETWORKS[net] ?? NETWORKS.test;
}

/** @param {string} txid @param {NetworkId} [net] */
export function explorerTx(txid, net = 'test') {
  return (EXPLORER_TX[net] ?? EXPLORER_TX.test).replace('{txid}', txid);
}

/**
 * Which network a viewing key / address string belongs to, by prefix (null if unknown).
 * Order matters: `uviewtest1` must be tested before `uview1`.
 * @param {string} s
 * @returns {NetworkId|null}
 */
export function networkOfPrefix(s) {
  if (/^(uviewtest1|uivktest1|utest1|ztestsapling1|tm|t2|textest1|usktest|secret-extended-key-test)/.test(s)) return 'test';
  if (/^(uview1|uivk1|u1|zs1|t1|t3|tex1|secret-extended-key-main)/.test(s)) return 'main';
  return null;
}
