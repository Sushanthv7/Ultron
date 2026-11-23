import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';
import './index.css';

// Tier 1: Global Google Maps authentication / quota failure handler
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

// Tier 1: Console interceptor for Maps OverQuotaMapError / QuotaExceededError
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const text = args
    .map((a) => (typeof a === 'string' ? a : String(a)))
    .join(' ');
  if (
    text.includes('OverQuotaMapError') ||
    text.includes('QuotaExceededError')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  originalConsoleError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>,
);
