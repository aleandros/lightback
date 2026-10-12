import React from 'react';
import ReactDOM from 'react-dom/client';
import { LightbackProvider } from '@lightback/react';
import { lightback, screenshot } from './lightback';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LightbackProvider
      client={lightback}
      widget={{ screenshot, onSent: (p) => console.info('[playground] sent', p.id) }}
      context={{ user: { id: 'u_123', email: 'demo@example.com', plan: 'pro' }, session: 'sess_abc' }}
    >
      <App />
    </LightbackProvider>
  </React.StrictMode>,
);
