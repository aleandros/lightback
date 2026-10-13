import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { App } from './App';
export const render = () => renderToString(<App />);
export const hydrate = (container: Element, onRecoverableError: (error: unknown) => void) =>
  hydrateRoot(container, <App />, { onRecoverableError });
