/**
 * landscape.js — Force Landscape Orientation on Video Playback
 * 
 * Handles two distinct scenarios:
 *   1. Native <video> elements — listens for play/pause/ended events directly
 *   2. Iframe-based players — provides an imperative API (forceLandscape / releaseLandscape)
 *      since we cannot access internal video events inside cross-origin iframes
 *
 * Strategy:
 *   - Primary:  Screen Orientation API + Fullscreen (Android, Chrome, Firefox)
 *   - Fallback: CSS transform rotation (iOS Safari, any browser where API fails)
 *
 * Usage:
 *   // Auto-setup for all native <video> elements on the page:
 *   LandscapeForcer.init();
 *
 *   // Imperative control for iframe wrappers:
 *   LandscapeForcer.forceLandscape(wrapperElement);
 *   LandscapeForcer.releaseLandscape(wrapperElement);
 */
(function () {
  'use strict';

  // ─── iOS Detection ───
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // ─── Portrait Detection ───
  function isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  // ─── Ensure wrapper div exists around an element ───
  function ensureWrapper(element) {
    // If already wrapped, return the existing wrapper
    if (element.parentElement && element.parentElement.classList.contains('video-wrapper')) {
      return element.parentElement;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    element.parentNode.insertBefore(wrapper, element);
    wrapper.appendChild(element);
    return wrapper;
  }

  // ─── Lock to Landscape (API attempt + CSS fallback) ───
  async function forceLandscape(wrapper) {
    // Only force if currently in portrait
    if (!isPortrait()) return;

    // Skip Screen Orientation API entirely on iOS — it doesn't work
    if (!isIOS) {
      try {
        // Most browsers require fullscreen before orientation lock works
        const target = wrapper.querySelector('video') || wrapper.querySelector('iframe') || wrapper;

        const requestFS =
          target.requestFullscreen ||
          target.webkitRequestFullscreen ||
          target.mozRequestFullScreen ||
          target.msRequestFullscreen;

        if (requestFS) {
          await requestFS.call(target);
        }

        if (screen.orientation && screen.orientation.lock) {
          await screen.orientation.lock('landscape');
          // API succeeded — mark so we know to use API unlock later
          wrapper.dataset.landscapeMethod = 'api';
          return; // No CSS fallback needed
        }
      } catch (err) {
        // API failed — fall through to CSS fallback
        console.warn('Screen Orientation API failed, using CSS fallback:', err.message);
        // Exit fullscreen if we entered it but orientation lock failed
        exitFullscreen();
      }
    }

    // CSS Transform Fallback (iOS + any failure case)
    wrapper.classList.add('force-landscape');
    wrapper.dataset.landscapeMethod = 'css';

    // Prevent body scroll while rotated
    document.body.style.overflow = 'hidden';
  }

  // ─── Unlock / Release Landscape ───
  function releaseLandscape(wrapper) {
    if (!wrapper) return;

    const method = wrapper.dataset.landscapeMethod;

    if (method === 'api') {
      // Unlock via Screen Orientation API
      try {
        screen.orientation?.unlock();
      } catch (e) {
        console.warn('Orientation unlock failed:', e.message);
      }
      exitFullscreen();
    }

    if (method === 'css' || wrapper.classList.contains('force-landscape')) {
      wrapper.classList.remove('force-landscape');
      document.body.style.overflow = '';
    }

    delete wrapper.dataset.landscapeMethod;
  }

  // ─── Exit Fullscreen Helper ───
  function exitFullscreen() {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else if (document.webkitFullscreenElement) {
        document.webkitExitFullscreen?.();
      } else if (document.mozFullScreenElement) {
        document.mozCancelFullScreen?.();
      } else if (document.msFullscreenElement) {
        document.msExitFullscreen?.();
      }
    } catch (e) {
      // Silently fail — not critical
    }
  }

  // ─── Attach events to a single <video> element ───
  function setupVideoElement(video) {
    // Skip if already initialized
    if (video.dataset.landscapeInit) return;
    video.dataset.landscapeInit = 'true';

    const wrapper = ensureWrapper(video);

    video.addEventListener('play', function () {
      forceLandscape(wrapper);
    });

    video.addEventListener('pause', function () {
      releaseLandscape(wrapper);
    });

    video.addEventListener('ended', function () {
      releaseLandscape(wrapper);
    });
  }

  // ─── Fullscreen change listener (user manually exits fullscreen) ───
  function handleFullscreenChange() {
    // If user exited fullscreen, release any active CSS rotation
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const activeWrappers = document.querySelectorAll('.video-wrapper[data-landscape-method="api"]');
      activeWrappers.forEach(function (wrapper) {
        releaseLandscape(wrapper);
      });
    }
  }

  // ─── Public Init: auto-setup all native <video> elements ───
  function init() {
    // Setup existing videos
    const videos = document.querySelectorAll('video');
    videos.forEach(setupVideoElement);

    // Watch for dynamically added videos
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === 'VIDEO') {
            setupVideoElement(node);
          }
          // Also check children of added nodes
          const childVideos = node.querySelectorAll ? node.querySelectorAll('video') : [];
          childVideos.forEach(setupVideoElement);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for fullscreen exit
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  }

  // ─── Expose Public API ───
  window.LandscapeForcer = {
    init: init,
    forceLandscape: forceLandscape,
    releaseLandscape: releaseLandscape,
    isPortrait: isPortrait,
    isIOS: isIOS
  };
})();
