/** Cheap invalidation only: never captures or retains host content. Active only while picking. */
export class PageChanges {
  private observer: MutationObserver | null = null;
  private revision = 0;
  private events = ['scroll', 'resize', 'input', 'change', 'load', 'toggle'] as const;

  private ignored(node: Node): boolean {
    const el = node instanceof Element ? node : node.parentElement;
    return Boolean(el?.closest('[data-lightback-ignore]'));
  }

  private mutations = (records: MutationRecord[]): void => {
    if (records.some((record) => {
      if (this.ignored(record.target)) return false;
      // Attaching/removing ignored UI must not invalidate the page beneath it.
      if (record.type === 'childList') {
        return [...record.addedNodes, ...record.removedNodes].some((node) => !this.ignored(node));
      }
      return true;
    })) this.revision++;
  };

  private changed = (event: Event): void => {
    if (event.composedPath().some((node) => node instanceof Element && this.ignored(node))) return;
    // Window/document scroll is already represented by geometry in key(); an event
    // delivered after a selection must not invalidate the same position a second time.
    if (event.type === 'scroll' && (event.target === document || event.target === window)) return;
    this.revision++;
  };

  start(): void {
    this.stop();
    this.revision++;
    this.observer = new MutationObserver(this.mutations);
    this.observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    for (const event of this.events) (event === 'load' ? document : window).addEventListener(event, this.changed, true);
  }

  /** Drain synchronous mutations too; scroll geometry catches changes before their events dispatch. */
  key(): string {
    if (this.observer) this.mutations(this.observer.takeRecords());
    const root = document.documentElement;
    return [this.revision, window.scrollX, window.scrollY, root.clientWidth, root.clientHeight, root.scrollWidth, root.scrollHeight].join(':');
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const event of this.events) (event === 'load' ? document : window).removeEventListener(event, this.changed, true);
  }
}
