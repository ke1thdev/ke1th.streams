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

// PWA Install Prompt Logic
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI notify the user they can install the PWA
  showInstallPromotion();
});

function showInstallPromotion() {
  if (document.getElementById('pwa-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 20, 20, 0.95);
    border: 1px solid #333;
    padding: 12px 20px;
    border-radius: 50px;
    display: flex;
    align-items: center;
    gap: 15px;
    z-index: 999999;
    box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    color: white;
    font-size: 0.9rem;
    font-family: inherit;
    animation: slideUpPwa 0.5s ease-out forwards;
    white-space: nowrap;
  `;
  
  if (!document.getElementById('pwa-anim')) {
      const anim = document.createElement('style');
      anim.id = 'pwa-anim';
      anim.textContent = `
        @keyframes slideUpPwa {
            from { bottom: -100px; opacity: 0; }
            to { bottom: 20px; opacity: 1; }
        }
      `;
      document.head.appendChild(anim);
  }

  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
        <img src="/assets/imgs/android-chrome-192x192.png" style="width:32px; height:32px; border-radius:6px;" />
        <div style="display:flex; flex-direction:column;">
            <span style="font-weight:600; color:#fff;">Install App</span>
            <span style="font-size:0.75rem; color:#aaa;">Add to Home Screen</span>
        </div>
    </div>
    <button id="pwa-install-btn" style="background:#e50914; color:white; border:none; padding:8px 16px; border-radius:20px; cursor:pointer; font-weight:600; font-size:0.85rem; margin-left: 5px;">Install</button>
    <button id="pwa-close-btn" style="background:transparent; border:none; color:#888; font-size:1.4rem; cursor:pointer; padding:0 5px;">&times;</button>
  `;

  document.body.appendChild(banner);

  document.getElementById('pwa-install-btn').addEventListener('click', async () => {
    banner.style.display = 'none';
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
    }
  });

  document.getElementById('pwa-close-btn').addEventListener('click', () => {
    banner.style.display = 'none';
  });
}

