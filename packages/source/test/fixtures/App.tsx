import React from 'react';
import { Badge } from './Badge';

export function App({ label = 'Ready' }: { label?: string }) {
  return (
    <main data-testid="fixture">
      <button data-testid="button">{label}</button>
      <Badge />
      <svg><path d="M0 0" /></svg>
    </main>
  );
}
