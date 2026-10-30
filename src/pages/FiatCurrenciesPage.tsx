import {useMemo, useState} from 'react';
import {useFiatData} from '../contexts/FiatDataContext';
import {usePresentation} from '../hooks/usePresentation';
import {getFiatSettings, saveFiatSettings, getDisplayFiatCurrency, setDisplayFiatCurrency} from '../services/settings';
import SlideInPage from '../components/layout/SlideInPage';
import {ChevronUpIcon, ChevronDownIcon, CheckIcon} from '../components/Icons';
import {currencyCatalog} from '../utils/currencyCatalog';
import {formatFiat} from '../utils/formatFiat';
import {currencyCopy} from '../locales/currencies';

export default function FiatCurrenciesPage({onBack}: {onBack: () => void}) {
  const {fiatCurrencies} = useFiatData();
  const {language} = usePresentation();
  const text = currencyCopy(language);
  const [selected, setSelected] = useState(() => [...new Set([...getFiatSettings().selectedCurrencies, getDisplayFiatCurrency()])]);
  const [primary, setPrimary] = useState(getDisplayFiatCurrency);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const currencies = useMemo(() => currencyCatalog(fiatCurrencies, selected, language), [fiatCurrencies, selected, language]);
  const normalized = query.trim().toLocaleLowerCase(language);
  const matches = (currency: typeof currencies[number]) => !normalized || [currency.id, currency.name, currency.symbol]
    .some(value => value.toLocaleLowerCase(language).includes(normalized));
  const chosen = selected.map(id => currencies.find(currency => currency.id === id)).filter(currency => currency !== undefined);
  const available = currencies.filter(currency => !selected.includes(currency.id));
  const rows = [...chosen, ...available].filter(matches);
  const save = (next: string[], active = primary) => {
    if (!next.length) return;
    setSelected(next);
    saveFiatSettings({selectedCurrencies: next});
    const nextPrimary = next.includes(active) ? active : next[0];
    setPrimary(nextPrimary);
    setDisplayFiatCurrency(nextPrimary);
    setStatus(text.saved);
  };
  const toggle = (id: string) => save(selected.includes(id) ? selected.filter(code => code !== id) : [...selected, id]);
  const move = (id: string, delta: number) => {
    const index = selected.indexOf(id), target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[index], next[target]] = [next[target], next[index]];
    save(next);
  };
  const button = 'min-h-11 min-w-11 rounded-xl border border-spark-border px-3 text-sm text-spark-text-secondary focus-visible:outline-2 focus-visible:outline-spark-primary disabled:opacity-40';
  return <SlideInPage title={text.title} closeStyle="back" onClose={onBack} slideFrom="right">
    <div className="p-4 space-y-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <p className="text-sm text-spark-text-secondary">{text.hint}</p>
      <div className="rounded-2xl border border-spark-border bg-spark-dark p-4" data-testid="currency-format-preview">
        <p className="text-xs text-spark-text-muted">{text.format} · <bdi>{primary}</bdi></p>
        <bdi className="block mt-2 text-xl font-semibold break-words">{formatFiat(1234567.89, primary, language)}</bdi>
      </div>
      <input type="search" inputMode="search" autoComplete="off" enterKeyHint="search"
        aria-label={text.search} placeholder={text.search} data-testid="currency-search"
        className="gys-currency-search" value={query} onChange={event => setQuery(event.currentTarget.value)} />
      <p className="sr-only" role="status" aria-live="polite">{normalized ? `${rows.length}` : status}</p>
      {rows.length === 0 && <p className="p-6 text-sm text-spark-text-secondary" data-testid="currency-no-results">{text.empty}</p>}
      {[{label: text.selected, items: chosen}, {label: text.more, items: available}].map(group => {
        const items = group.items.filter(matches);
        return items.length > 0 && <section key={group.label} aria-label={group.label} className="space-y-2">
          <h2 className="text-xs font-semibold text-spark-text-muted py-1">{group.label}</h2>
          {items.map(currency => {
            const checked = selected.includes(currency.id), index = selected.indexOf(currency.id);
            return <div key={currency.id} data-testid={`currency-${currency.id}`} className="rounded-2xl border border-spark-border bg-spark-dark p-3">
              <label className="flex min-h-11 items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggle(currency.id)}
                  disabled={checked && selected.length === 1} aria-label={`${currency.id} ${currency.name}`}
                  aria-describedby={checked && selected.length === 1 ? 'currency-keep-one' : undefined}
                  className="w-6 h-6 shrink-0 accent-spark-primary" />
                <span className="min-w-0 flex-1"><bdi className="font-semibold">{currency.id}</bdi>
                  <span className="block text-sm text-spark-text-secondary break-words">{currency.name}</span></span>
                <bdi className="text-spark-text-muted">{currency.symbol}</bdi>
              </label>
              {checked && <div className="mt-3 flex flex-wrap gap-2 items-center">
                <button type="button" className={`${button} flex-1 flex gap-2 items-center justify-center ${primary === currency.id ? 'text-spark-primary border-spark-primary' : ''}`}
                  aria-label={`${text.use}: ${currency.id}`} aria-pressed={primary === currency.id} onClick={() => save(selected, currency.id)}>
                  {primary === currency.id && <CheckIcon size="sm"/>}{primary === currency.id ? text.active : text.use}
                </button>
                <button type="button" className={button} disabled={index === 0 || !!normalized} onClick={() => move(currency.id, -1)} aria-label={`${text.up}: ${currency.id}`}><ChevronUpIcon/></button>
                <button type="button" className={button} disabled={index === selected.length - 1 || !!normalized} onClick={() => move(currency.id, 1)} aria-label={`${text.down}: ${currency.id}`}><ChevronDownIcon/></button>
              </div>}
            </div>;
          })}
        </section>;
      })}
      <p id="currency-keep-one" className="text-xs text-spark-text-muted">{text.last}</p>
    </div>
  </SlideInPage>;
}
