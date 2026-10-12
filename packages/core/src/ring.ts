export class RingBuffer<T> {
  private items: T[] = [];
  constructor(private capacity: number, private onChange?: () => void) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    this.onChange?.();
  }

  /** Notify subscribers after mutating an entry already in the buffer (for asynchronous bodies). */
  touch(): void {
    this.onChange?.();
  }

  toArray(): T[] {
    return this.items.slice();
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}
