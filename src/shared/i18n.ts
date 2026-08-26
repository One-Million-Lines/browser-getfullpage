type I18nSubstitutions = string | string[];

type I18nApi = {
  getMessage(key: string, substitutions?: I18nSubstitutions): string;
  getUILanguage?: () => string;
};

function api(): I18nApi | undefined {
  const g = globalThis as typeof globalThis & {
    browser?: { i18n?: I18nApi };
    chrome?: { i18n?: I18nApi };
  };
  return g.browser?.i18n ?? g.chrome?.i18n;
}

export function t(key: string, substitutions?: I18nSubstitutions, fallback?: string): string {
  return api()?.getMessage(key, substitutions) || fallback || key;
}

export function localizeDocument(root: ParentNode = document): void {
  const i18n = api();
  const doc = root instanceof Document ? root : document;
  const lang = i18n?.getUILanguage?.();
  if (lang) doc.documentElement.lang = lang.replace('_', '-');

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n ?? '', undefined, el.textContent ?? '');
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml ?? '', undefined, el.innerHTML);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.placeholder = t(el.dataset.i18nPlaceholder ?? '', undefined, input.placeholder);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute(
      'aria-label',
      t(el.dataset.i18nAriaLabel ?? '', undefined, el.getAttribute('aria-label') ?? ''),
    );
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-alt]').forEach((el) => {
    const img = el as HTMLImageElement;
    img.alt = t(el.dataset.i18nAlt ?? '', undefined, img.alt);
  });
}
