import type { WidgetHandle, WidgetOptions } from './types';
import { defaultStrings } from './strings';
import { createHost, shellStyles } from './shell';

export interface LazyWidgetHandle extends WidgetHandle {
  /** Resolves when the UI is ready; rejects on load failure. Call again to retry. */
  open(): Promise<void>;
  startPicking(): Promise<void>;
}

/** Internal loader injection keeps the module and standalone entries on the same lifecycle. */
export function createLazyWidget(
  options: WidgetOptions,
  load: () => Promise<{ mountWidget(options: WidgetOptions, element: HTMLElement): WidgetHandle }>,
): LazyWidgetHandle {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('Lightback: mountLazyWidget requires a browser DOM');
  const opts = { ...options, strings: { ...options.strings } };
  const strings = { ...defaultStrings, ...(opts.triggerLabel !== undefined ? { pillOpen: opts.triggerLabel } : {}), ...opts.strings };
  const element = createHost(opts);
  const root = element.shadowRoot!;
  const style = document.createElement('style');
  style.textContent = shellStyles + '[data-ref=loadStatus] { display: block; padding: 8px; margin-top: 6px; background: var(--lb-bg); border: 1px solid var(--lb-border); border-radius: var(--lb-radius); }';
  const pill = document.createElement('div');
  pill.className = 'lb-pill';
  pill.dataset.ref = 'pill';
  pill.setAttribute('part', 'pill');
  pill.setAttribute('role', 'group');
  pill.setAttribute('aria-label', strings.feedback);
  pill.hidden = Boolean(opts.hideTrigger);
  for (const [action, ref, label] of [['pick', 'pillPick', strings.pillPick], ['open', 'pillOpen', strings.pillOpen]] as const) {
    if (action === 'open') {
      const separator = document.createElement('span');
      separator.className = 'lb-pill-sep';
      pill.appendChild(separator);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lb-pill-btn';
    button.dataset.action = action;
    button.dataset.ref = ref;
    button.textContent = label;
    pill.appendChild(button);
  }
  const status = document.createElement('span');
  status.dataset.ref = 'loadStatus';
  status.setAttribute('role', 'status');
  status.hidden = true;
  root.append(style, pill, status);
  document.body.appendChild(element);

  let widget: WidgetHandle | undefined;
  let pending: Promise<void> | undefined;
  let intent: 'open' | 'startPicking' | undefined;
  let destroyed = false;
  void Promise.resolve(opts.client.ready).then(() => {
    if (destroyed || widget) return;
    const draft = opts.client.getDraft?.();
    if (!draft) return;
    const count = draft.selections.length;
    pill.querySelector('[data-ref=pillPick]')!.textContent = count ? strings.pillPickCount(count) : strings.pillPick;
    pill.querySelector('[data-ref=pillOpen]')!.textContent = count || draft.text ? strings.pillReview : strings.pillOpen;
  });
  const activate = (action: 'open' | 'startPicking'): Promise<void> => {
    if (destroyed) return Promise.resolve();
    if (widget) { widget[action](); return Promise.resolve(); }
    intent = action;
    if (pending) return pending;
    status.hidden = Boolean(opts.hideTrigger);
    status.textContent = strings.loading;
    pill.setAttribute('aria-busy', 'true');
    // Do not mute collectors while downloading: host activity must keep accumulating.
    pending = Promise.all([Promise.resolve().then(load), opts.client.ready]).then(([module]) => {
      if (destroyed || !intent) return;
      widget = module.mountWidget(opts, element);
      root.removeEventListener('click', onClick);
      widget[intent]();
    }).catch((error: unknown) => {
      if (!destroyed) {
        status.textContent = strings.loadFailed;
        opts.onError?.(error);
      }
      throw error;
    }).finally(() => {
      pending = undefined;
      pill.removeAttribute('aria-busy');
    });
    // Void-style callers (including React event handlers) remain safe; awaiters still see rejection.
    void pending.catch(() => {});
    return pending;
  };
  const onClick = (event: Event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'open' || action === 'pick') void activate(action === 'open' ? 'open' : 'startPicking');
  };
  root.addEventListener('click', onClick);
  return {
    element,
    open: () => activate('open'),
    startPicking: () => activate('startPicking'),
    close() {
      intent = undefined;
      status.hidden = true;
      widget?.close();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      intent = undefined;
      root.removeEventListener('click', onClick);
      widget?.destroy();
      element.remove();
    },
  };
}
