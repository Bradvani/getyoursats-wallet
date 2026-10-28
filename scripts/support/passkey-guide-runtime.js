// Appended to the generated locale catalog by generate-passkey-guide.mjs.
(() => {
  'use strict';
  const section = document.getElementById('section-1');
  const select = document.getElementById('gys-language');
  if (!section || !select) return;
  const copies = PASSKEY_SUPPORT_COPY;
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  for (const [code, copy] of Object.entries(copies)) {
    if (!Array.from(select.options).some(option => option.value === code)) {
      select.add(new Option(copy.name, code));
    }
  }
  function revealHash(scroll = false) {
    const target = document.getElementById(location.hash.slice(1));
    if (target && section.contains(target) && target.tagName === 'DETAILS') {
      target.open = true;
      if (scroll) target.scrollIntoView({ block: 'start' });
    }
  }
  function render(code) {
    const language = Object.hasOwn(copies, code) ? code : 'en';
    const copy = copies[language];
    const previouslyOpen = new Set(Array.from(section.querySelectorAll('details[open]'), el => el.id));
    section.lang = language;
    section.dir = language === 'ar' ? 'rtl' : 'ltr';
    section.replaceChildren();
    const heading = node('h2', copy.title);
    heading.id = 'passkey-guide-title';
    section.append(heading, node('p', copy.intro));
    const safety = node('p', copy.safety);
    safety.className = 'note';
    section.append(safety);
    for (const [id, scenario] of Object.entries(copy.scenarios)) {
      const detail = node('details');
      detail.id = `passkey-${id}`;
      detail.className = 'gys-passkey-case';
      detail.open = previouslyOpen.has(detail.id);
      detail.append(node('summary', scenario.title));
      const list = node('ol');
      for (const step of scenario.steps) list.append(node('li', step));
      detail.append(list);
      section.append(detail);
    }
    const contact = node('p');
    const link = node('a', copy.contact);
    link.href = '#contact';
    contact.append(link);
    section.append(contact);
    const sources = node('p', copy.source + ': ');
    PASSKEY_SUPPORT_SOURCES.forEach(([label, href], index) => {
      if (index) sources.append(document.createTextNode(' · '));
      const link = node('a', label);
      link.href = href;
      link.rel = 'noopener noreferrer';
      sources.append(link);
    });
    section.append(sources);
    document.querySelectorAll('a[href="#section-1"]').forEach(link => { link.textContent = copy.nav; });
    select.value = language;
    select.setAttribute('aria-label', copy.language);
    revealHash();
  }
  function storedLanguage() {
    try { return localStorage.getItem('gys:language:v1') || localStorage.getItem('gys:help-lang'); }
    catch { return null; }
  }
  function deviceLanguage() {
    for (const raw of navigator.languages || []) {
      const code = raw.toLowerCase();
      if (code === 'zh' || code === 'zh-cn' || code === 'zh-sg' || code.startsWith('zh-hans')) return 'zh-CN';
      const base = code.split('-')[0];
      if (Object.hasOwn(copies, base)) return base;
    }
    return 'en';
  }
  select.addEventListener('change', () => {
    const language = Object.hasOwn(copies, select.value) ? select.value : 'en';
    render(language);
    try { localStorage.setItem('gys:help-lang', language); } catch { /* Storage is optional for help. */ }
    const url = new URL(location.href);
    url.searchParams.set('lang', language);
    history.replaceState(null, '', url);
  });
  const requested = new URL(location.href).searchParams.get('lang') || storedLanguage() || deviceLanguage();
  select.value = Object.hasOwn(copies, requested) ? requested : 'en';
  // Reuse the existing page and wallet explainer language listeners.
  select.dispatchEvent(new Event('change'));
  window.addEventListener('hashchange', () => revealHash(true));
  revealHash(true);
})();
