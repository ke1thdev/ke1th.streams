// TMDB API Configuration
// Note: TMDB API keys are designed for client-side use and are rate-limited
const TMDB_CONFIG = {
  // If using direct TMDB API, enter your key here. If using a proxy, leave it blank.
  API_KEY: '',
  BASE_URL: 'https://tmdb-proxy.ke1th.dev',
  IMAGE_BASE: 'https://image.tmdb.org/t/p/w500',
  BACKDROP_BASE: 'https://image.tmdb.org/t/p/original',
  LANGUAGE: 'en-US',
  WATCH_REGION: 'PH'
};

// Export for use in other modules
window.TMDB_CONFIG = TMDB_CONFIG;

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      //console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }, err => {
      //console.log('ServiceWorker registration failed: ', err);
    });
  });
}

// Disable text selection and inspect element features globally
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    * {
      -webkit-user-select: none;
      -ms-user-select: none;
      user-select: none;
    }
    input, textarea {
      -webkit-user-select: auto;
      -ms-user-select: auto;
      user-select: auto;
    }
  `;
  document.head.appendChild(style);
});

document.addEventListener('contextmenu', event => {
  if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
    event.preventDefault();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
    (e.ctrlKey && (e.key === 'U' || e.key === 'u'))) {
    e.preventDefault();
  }
  if (e.ctrlKey && (e.key === 'A' || e.key === 'a')) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
    }
  }
});