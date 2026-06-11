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
 *
 *   // Simple orientation lock (no CSS fallback, no fullscreen) for full-page players:
 *   LandscapeForcer.lockOrientation();
 *   LandscapeForcer.unlockOrientation();
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

  // ─── Create a close button for the CSS rotation overlay ───
  function createCloseButton(wrapper) {
    // Don't duplicate
    if (wrapper.querySelector('.force-landscape-close')) return;

    const btn = document.createElement('button');
    btn.className = 'force-landscape-close';
    btn.setAttribute('aria-label', 'Exit landscape');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      releaseLandscape(wrapper);
    });
    wrapper.appendChild(btn);
  }

  // ─── Remove the close button ───
  function removeCloseButton(wrapper) {
    const btn = wrapper.querySelector('.force-landscape-close');
    if (btn) btn.remove();
  }

  // ─── Lock to Landscape (API attempt + CSS fallback) ───
  async function forceLandscape(wrapper) {
    // Only force if currently in portrait
    if (!isPortrait()) return;

    // Skip Screen Orientation API entirely on iOS — it doesn't work
    if (!isIOS) {
      try {
        // Most browsers require fullscreen before orientation lock works
        const target = wrapper.querySelector('.plyr') || wrapper.querySelector('video') || wrapper.querySelector('iframe') || wrapper;

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
    createCloseButton(wrapper);

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
      removeCloseButton(wrapper);
      document.body.style.overflow = '';
    }

    delete wrapper.dataset.landscapeMethod;
  }

  // ─── Simple orientation lock (no fullscreen, no CSS fallback) ───
  // Used for full-page players like watch.html where the entire page IS the player.
  // Does NOT request fullscreen or apply CSS rotation.
  async function lockOrientation() {
    if (isIOS) return; // iOS doesn't support this API at all
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      }
    } catch (err) {
      // Silently fail — this is a best-effort enhancement
      console.warn('Orientation lock failed (expected without fullscreen):', err.message);
    }
  }

  function unlockOrientation() {
    try {
      screen.orientation?.unlock();
    } catch (e) {
      // Silently fail
    }
  }

  // ─── Fullscreen-aware orientation lock ───
  // When user enters fullscreen (e.g. via iframe player controls),
  // try to lock orientation to landscape at that point.
  function handleFullscreenChange() {
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;

    if (fsElement) {
      // User ENTERED fullscreen — try to lock landscape
      if (isPortrait() && !isIOS) {
        try {
          if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(function () {});
          }
        } catch (e) {}
      }
    } else {
      // User EXITED fullscreen — unlock orientation + clean up any CSS wrappers
      try {
        screen.orientation?.unlock();
      } catch (e) {}

      const activeWrappers = document.querySelectorAll('.video-wrapper[data-landscape-method="api"]');
      activeWrappers.forEach(function (wrapper) {
        releaseLandscape(wrapper);
      });
    }
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

    // Listen for fullscreen changes — lock orientation when entering fullscreen
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    // ─── Auto-remove CSS rotation when device physically rotates to landscape ───
    // Prevents the "upside down" bug: if CSS rotate(90deg) is active and user
    // physically rotates to landscape, the rotation stacks → upside down.
    // We detect the natural landscape and release the CSS rotation.
    function handleOrientationChange() {
      if (!isPortrait()) {
        // Device is now naturally in landscape — remove any CSS rotation
        var rotatedWrappers = document.querySelectorAll('.video-wrapper.force-landscape');
        rotatedWrappers.forEach(function (wrapper) {
          releaseLandscape(wrapper);
        });
      }
    }

    window.addEventListener('resize', handleOrientationChange);
    window.addEventListener('orientationchange', handleOrientationChange);
  }

  // ─── Expose Public API ───
  window.LandscapeForcer = {
    init: init,
    forceLandscape: forceLandscape,
    releaseLandscape: releaseLandscape,
    lockOrientation: lockOrientation,
    unlockOrientation: unlockOrientation,
    isPortrait: isPortrait,
    isIOS: isIOS
  };
})();
