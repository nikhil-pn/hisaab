// Amount helpers. zkool_graphql returns amounts as GraphQL `BigDecimal`
// scalars, serialized as decimal ZEC *strings* with scale 8 (e.g. "0.01000000",
// "-0.00010000"). All Hisaab math is done in integer zatoshis (BigInt-safe
// Numbers: max supply 21e6 ZEC = 2.1e15 zats < 2^53).

export const ZATS_PER_ZEC = 100_000_000;

/**
 * Convert a decimal ZEC value (string or number) to integer zatoshis.
 * Rejects more than 8 decimal places and non-numeric input.
 * @param {string|number} zec
 * @returns {number}
 */
export function zecToZats(zec) {
  if (typeof zec === 'number') {
    if (!Number.isFinite(zec)) throw new Error(`Invalid ZEC amount: ${zec}`);
    zec = zec.toFixed(8);
  }
  if (typeof zec !== 'string') throw new Error(`Invalid ZEC amount: ${zec}`);
  const s = zec.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
    throw new Error(`Invalid ZEC amount: "${zec}"`);
  }
  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] || '0';
  let frac = m[3] || '';
  // Allow trailing zeros beyond 8 places (e.g. "0.0100000000"), nothing else.
  if (frac.length > 8) {
    if (/[^0]/.test(frac.slice(8))) throw new Error(`More than 8 decimals: "${zec}"`);
    frac = frac.slice(0, 8);
  }
  frac = frac.padEnd(8, '0');
  const zats = Number(whole) * ZATS_PER_ZEC + Number(frac);
  if (!Number.isSafeInteger(zats)) throw new Error(`Amount out of range: "${zec}"`);
  return sign * zats === 0 ? 0 : sign * zats;
}

/**
 * Integer zatoshis → decimal ZEC string with trailing zeros trimmed
 * ("0.01", "1", "-0.0001"). This is also the ZIP 321 `amount` format.
 * @param {number} zats
 * @param {{fixed?: boolean}} [opts] fixed → always 8 decimals
 * @returns {string}
 */
export function zatsToZec(zats, opts = {}) {
  if (!Number.isSafeInteger(zats)) throw new Error(`Invalid zatoshi amount: ${zats}`);
  const neg = zats < 0;
  const abs = Math.abs(zats);
  const whole = Math.floor(abs / ZATS_PER_ZEC);
  let frac = String(abs % ZATS_PER_ZEC).padStart(8, '0');
  if (!opts.fixed) frac = frac.replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}
