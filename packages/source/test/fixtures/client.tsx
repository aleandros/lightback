import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { App } from './App';

export const hydrate = (container: Element, onRecoverableError: (error: unknown) => void) =>
  hydrateRoot(container, <App />, { onRecoverableError });
