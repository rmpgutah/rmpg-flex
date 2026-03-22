import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Remove the inline pre-splash once React takes over
const preSplash = document.getElementById('pre-splash');
if (preSplash) {
  preSplash.style.opacity = '0';
  setTimeout(() => preSplash.remove(), 300);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
