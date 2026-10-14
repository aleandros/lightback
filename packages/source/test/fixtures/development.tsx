import { version } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { describeElement } from '../../../core/src/inspect';

// This fixture deliberately has no source plugin: locations must come from React 19.
const root = createRoot(document.getElementById('root')!);
root.render(<App label="React 19" />);
Object.assign(window, { fixture: { version, describeElement } });
