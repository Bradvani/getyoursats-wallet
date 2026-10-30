import type {FiatCurrency} from '@breeztech/breez-sdk-spark';
import {fiatLocale} from './formatFiat';

const fallback = ['USD','INR','EUR','GBP','JPY','CHF','CAD','AUD','BRL','CNY','THB','VND','AED','SAR','KWD'];
const valid = (code: string) => /^[A-Z]{3}$/.test(code) && !['BTC','XTS','XXX'].includes(code);

/** Display preferences remain available offline; this catalog does not promise a live rate. */
export function currencyCatalog(known: FiatCurrency[], selected: string[], language: string) {
  const intl = Intl as typeof Intl & {supportedValuesOf?: (key: 'currency') => string[]};
  const codes = [...new Set([...(intl.supportedValuesOf?.('currency') ?? fallback), ...known.map(c => c.id), ...selected])].filter(valid).sort();
  const names = new Intl.DisplayNames(language, {type: 'currency'});
  return codes.map(id => ({id, name: names.of(id) ?? known.find(c => c.id === id)?.info.name ?? id,
    symbol: new Intl.NumberFormat(fiatLocale(id, language), {style: 'currency', currency: id, numberingSystem: 'latn'})
      .formatToParts(0).find(part => part.type === 'currency')?.value ?? id}));
}
