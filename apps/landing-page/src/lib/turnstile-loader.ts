// Browser side: load Cloudflare Turnstile's script once per page. Shares the
// `script[data-turnstile-loader]` tag the site's other forms use, so whichever
// form asks first loads it and the rest reuse it.

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let pending: Promise<void> | null = null;

const ready = () => typeof (window as { turnstile?: unknown }).turnstile !== 'undefined';

export function loadTurnstileScript(): Promise<void> {
  if (ready()) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise<void>((resolve, reject) => {
    const settle = () => (ready() ? resolve() : reject(new Error('Turnstile unavailable')));
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-loader]');
    if (existing) {
      if (existing.dataset.turnstileLoaded === 'true') return settle();
      if (existing.dataset.turnstileError === 'true') return reject(new Error('Turnstile failed'));
      existing.addEventListener('load', settle, { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile failed')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.defer = true;
    script.dataset.turnstileLoader = 'true';
    script.addEventListener(
      'load',
      () => {
        script.dataset.turnstileLoaded = 'true';
        settle();
      },
      { once: true }
    );
    script.addEventListener(
      'error',
      () => {
        script.dataset.turnstileError = 'true';
        reject(new Error('Turnstile failed'));
      },
      { once: true }
    );
    document.head.appendChild(script);
  }).catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
