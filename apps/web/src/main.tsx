import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { messages } from '@isuv/i18n';
import './styles.css';

function App() {
  return (
    <main>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header>
        <p className="eyebrow">iSuv · Regional water operations</p>
        <h1>Operator workspace</h1>
        <p className="notice" role="status">
          {messages.en.syntheticData}
        </p>
      </header>
      <section id="content" aria-labelledby="foundation-heading">
        <h2 id="foundation-heading">Foundation is ready</h2>
        <p>
          Live monitoring, allocation accounting, GIS topology, and incident workflows are being
          added in governed phases.
        </p>
        <dl>
          <div>
            <dt>Stage</dt>
            <dd>metres (m)</dd>
          </div>
          <div>
            <dt>Discharge</dt>
            <dd>cubic metres per second (m³/s)</dd>
          </div>
          <div>
            <dt>Accumulated volume</dt>
            <dd>cubic metres (m³)</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
