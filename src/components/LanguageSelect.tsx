import { loadLocaleFonts } from '@/locales/loadFonts';
import { useEffect, useId, useState } from 'react';
import {
  Combobox,
  ComboboxInput,
  ComboboxButton,
  ComboboxOptions,
  ComboboxOption,
} from '@headlessui/react';
import {
  APP_LANGUAGES,
  setAppLanguage,
  type AppLanguage,
} from '@/services/presentationPreferences';
import { usePresentation } from '@/hooks/usePresentation';
import { PAYMENT_UX } from '@/locales/paymentUx';
import { ChevronDownIcon } from './Icons';

export default function LanguageSelect() {
  const { language, copy } = usePresentation();
  const text = PAYMENT_UX[language];
  const [query, setQuery] = useState('');
  const id = useId();
  useEffect(() => {
    void loadLocaleFonts();
  }, []);
  const options = APP_LANGUAGES.filter((item) =>
    `${item.name} ${item.subtitle}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-spark-text-primary"
      >
        {copy.language}
      </label>
      <Combobox
        value={language}
        onChange={(value: AppLanguage | null) => {
          if (value) setAppLanguage(value);
        }}
        onClose={() => setQuery('')}
      >
        <div className="relative">
          <ComboboxInput
            id={id}
            aria-label={copy.language}
            autoComplete="off"
            placeholder={text.search}
            displayValue={(code: AppLanguage) =>
              APP_LANGUAGES.find((item) => item.code === code)?.name ?? ''
            }
            onChange={(event) => setQuery(event.target.value)}
            className="w-full min-h-12 rounded-xl border border-spark-border bg-spark-surface ps-4 pe-12 text-spark-text-primary focus:outline-2 focus:outline-spark-primary"
          />
          <ComboboxButton
            aria-label={copy.language}
            className="absolute inset-y-0 end-0 px-4 text-spark-text-secondary"
          >
            <ChevronDownIcon />
          </ComboboxButton>
        </div>
        <ComboboxOptions
          anchor="bottom start"
          portal
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          className="gys-language-options z-[100010] w-[var(--input-width)] max-h-[min(20rem,50dvh)] overflow-y-auto overscroll-contain rounded-xl border border-spark-border bg-spark-surface p-1 shadow-xl [--anchor-gap:6px]"
        >
          {options.length === 0 && (
            <p className="p-3 text-sm text-spark-text-secondary">
              {text.noResults}
            </p>
          )}
          {options.map((item) => (
            <ComboboxOption
              key={item.code}
              value={item.code}
              className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-spark-text-primary data-focus:bg-spark-primary/15 data-selected:font-bold"
            >
              <span lang={item.code} dir={item.code === 'ar' ? 'rtl' : 'ltr'}>
                {item.name}
              </span>
              <span className="text-xs text-spark-text-secondary" dir="ltr">
                {item.subtitle}
              </span>
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
      <p className="text-xs leading-relaxed text-spark-text-muted">
        {text.partial}
      </p>
    </div>
  );
}
