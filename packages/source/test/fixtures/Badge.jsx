import React from 'react';

export function Badge() {
  const badge = <span data-testid="badge">JSX</span>;
  // Keep a caller frame in WebKit, which can eliminate direct-return JSX tail calls.
  return badge;
}
