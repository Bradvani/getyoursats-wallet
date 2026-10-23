/**
 * Optional third-party checkout. The public Onramper widget key is NOT a
 * server signing secret. We deliberately do not prefill wallets/networkWallets:
 * partner-signed destination binding needs a server-side signer and a verified
 * Spark-compatible BTC deposit address, neither of which exists yet.
 */
export function onramperAvailable(enabled: string | undefined, apiKey: string | undefined, network: string | undefined): boolean {
  return enabled === 'true' && network === 'mainnet'
    && typeof apiKey === 'string' && /^pk_prod_[A-Za-z0-9_]+$/.test(apiKey);
}

export function onramperBuyUrl(apiKey: string): string {
  if (!/^pk_prod_[A-Za-z0-9_]+$/.test(apiKey)) throw new Error('Invalid Onramper partner key');
  const url = new URL('https://buy.onramper.com/');
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('mode', 'buy');
  url.searchParams.set('onlyCryptos', 'btc');
  url.searchParams.set('onlyCryptoNetworks', 'bitcoin');
  url.searchParams.set('enableCountrySelector', 'true');
  url.searchParams.set('redirectAtCheckout', 'false');
  return url.toString();
}
