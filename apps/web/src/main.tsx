import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './context/ThemeContext';
import './styles.css';

if (window.location.pathname !== '/') {
  window.location.replace(`/${window.location.search}${window.location.hash}`);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider><App /></ThemeProvider>
    </StrictMode>
  );
}
