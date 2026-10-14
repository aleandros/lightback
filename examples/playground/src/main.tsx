import React from 'react';
import ReactDOM from 'react-dom/client';
import { LightbackProvider } from '@lightback/react';
import { mountFeedbackThread } from '@lightback/mcp/browser';
import { lightback, screenshot, feedbackBridge } from './lightback';
import { App } from './App';
import './styles.css';

// Viewport captures stay fast on long pages; `?shot=page` switches to whole-page captures (e2e covers both).
const screenshotArea = new URLSearchParams(location.search).get('shot') === 'page' ? 'page' : 'viewport';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LightbackProvider
      client={lightback}
      widget={{ screenshot, screenshotArea, onSent: (p) => console.info('[playground] sent', p.id) }}
      context={{ user: { id: 'u_123', email: 'demo@example.com', plan: 'pro' }, session: 'sess_abc' }}
    >
      <App />
    </LightbackProvider>
  </React.StrictMode>,
);

if (feedbackBridge) {
  const thread = mountFeedbackThread({ bridge: feedbackBridge });
  import.meta.hot?.dispose(() => thread.destroy());
}
