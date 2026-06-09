import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './responsive.css'; // J-CVE-101203 — global responsiveness & perceived-speed layer
import App from './App.tsx';

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}