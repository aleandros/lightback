import { isDemo } from './mode';

async function start() {
  if (isDemo) {
    if (!('serviceWorker' in navigator)) throw new Error('This demo needs a browser with service worker support.');
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}demo-worker.js`, {
      scope: import.meta.env.BASE_URL,
    });
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve, reject) => {
        const onChange = () => {
          if (!navigator.serviceWorker.controller) return;
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
          resolve();
        };
        const timer = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange);
          reject(new Error('The demo could not start. Please reload the page.'));
        }, 10000);
        navigator.serviceWorker.addEventListener('controllerchange', onChange);
        // A forced reload can bypass an already-active worker (notably Firefox).
        // Ask it to claim this page again; activation alone only covers installation.
        registration.active?.postMessage('lightback:claim');
        onChange();
      });
    }
  }
  await import('./main');
}

void start().catch((error: unknown) => {
  const root = document.getElementById('root')!;
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : 'The demo could not start. Please reload the page.';
  const docs = document.createElement('a');
  docs.href = 'https://aleandros.github.io/lightback/';
  docs.textContent = 'Read the Lightback guide';
  root.replaceChildren(message, docs);
});
