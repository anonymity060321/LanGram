import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

function App(): JSX.Element {
  return (
    <main className="app-shell">
      <section className="placeholder-panel">
        <h1>LanGram</h1>
        <p>Phase 0 project skeleton</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
