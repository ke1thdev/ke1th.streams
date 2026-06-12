(async function() {
  const urlParams = new URLSearchParams(window.location.search);
  const type = urlParams.get('type');
  const id = urlParams.get('id');
  const season = urlParams.get('season') || 1;
  const episode = urlParams.get('episode') || 1;
  const malId = urlParams.get('malId');
  const isAnime = urlParams.get('anime') === '1';

  const els = {
    title: document.getElementById('watchTitle'),
    header: document.querySelector('.watch-header'),
    backBtn: document.getElementById('backBtn'),
    floatingBackBtn: document.getElementById('floatingBackBtn'),
    serverSelect: document.getElementById('serverSelect'),
    videoFrame: document.getElementById('videoFrame'),
    toast: document.getElementById('toast'),
    tapInterceptor: document.getElementById('tapInterceptor')
  };

  let state = {
    type,
    id,
    season,
    episode,
    malId,
    isAnime,
    activeServer: localStorage.getItem('preferredServer') || 'videasy'
  };

  function init() {
    if (!state.type || !state.id) {
      window.location.href = '/';
      return;
    }

    // Listen for fullscreen changes so orientation locks when user goes fullscreen
    // via the iframe player's own fullscreen button
    LandscapeForcer.init();

    els.serverSelect.value = state.activeServer;
    els.serverSelect.addEventListener('change', handleServerChange);
    els.backBtn.addEventListener('click', handleBack);
    setupFloatingBackBtn();
    setupGlassOverlay();
    setupFullscreenSync();
    
    window.addEventListener('message', handlePlayerMessage);

    fetchDetails();
    loadPlayer();
    initDisclaimer();
  }

  // ─── Immersive Mode Cleanup ───
  function exitImmersiveMode() {
    try {
      screen.orientation?.unlock();
    } catch (e) {}
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
    } catch (e) {}
  }

  function setupFloatingBackBtn() {
    if (!els.floatingBackBtn) return;
    els.floatingBackBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      handleBack();
    });
  }

  // ─── Floating Glass Overlay (Mobile) ───
  // Auto-hides the header after 3 seconds, re-appears on any screen tap.
  // Uses a transparent tap-interceptor div that sits over the iframe
  // because clicks inside an iframe don't bubble to the parent document.
  function setupGlassOverlay() {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile || !els.header || !els.tapInterceptor) return;

    let hideTimer = null;
    let isSelectOpen = false;

    function showOverlay() {
      els.header.classList.remove('glass-hidden');
      // Deactivate interceptor so user can interact with iframe
      els.tapInterceptor.classList.remove('active');
      resetHideTimer();
    }

    function hideOverlay() {
      if (isSelectOpen) return;
      els.header.classList.add('glass-hidden');
      // Activate interceptor to catch the next tap
      els.tapInterceptor.classList.add('active');
    }

    function resetHideTimer() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideOverlay, 3000);
    }

    // Start the initial auto-hide timer
    resetHideTimer();

    // Tap on the interceptor → show the overlay
    els.tapInterceptor.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showOverlay();
    });

    // Tap on header controls → reset the timer
    els.header.addEventListener('click', function (e) {
      // If back or select was clicked, those have their own handlers
      resetHideTimer();
    });

    // Prevent auto-hide while interacting with the server select dropdown
    els.serverSelect.addEventListener('focus', function () {
      isSelectOpen = true;
      clearTimeout(hideTimer);
    });
    els.serverSelect.addEventListener('blur', function () {
      isSelectOpen = false;
      resetHideTimer();
    });
    els.serverSelect.addEventListener('change', function () {
      isSelectOpen = false;
      resetHideTimer();
    });
  }

  // ─── Videasy Fullscreen Sync Fix ───
  // Detects when browser exits fullscreen (e.g. pressing ESC or swipe-down)
  // and notifies the Videasy iframe so its internal fullscreen icon resets.
  // Without this, the Videasy player thinks it's still in fullscreen and
  // any click re-opens the native fullscreen.
  function setupFullscreenSync() {
    function onFullscreenExit() {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      
      if (!fsElement && els.videoFrame && els.videoFrame.contentWindow) {
        // Browser has EXITED fullscreen — tell the iframe player
        try {
          // Videasy uses postMessage to communicate — send exit fullscreen command
          els.videoFrame.contentWindow.postMessage(
            { type: 'FULLSCREEN_EXIT', event: 'exitFullscreen', fullscreen: false },
            '*'
          );
          els.videoFrame.contentWindow.postMessage(
            JSON.stringify({ type: 'FULLSCREEN_EXIT', event: 'exitFullscreen', fullscreen: false }),
            '*'
          );
        } catch (e) {
          // Cross-origin — expected to fail silently
        }

        // Forcefully remove the iframe from fullscreen state by briefly
        // removing and re-adding the allowfullscreen attribute
        // This resets the browser's internal fullscreen permission for the iframe
        if (state.activeServer === 'videasy') {
          try {
            const currentSrc = els.videoFrame.src;
            // Only reload if the iframe is still pointing to videasy
            if (currentSrc.includes('videasy')) {
              els.videoFrame.removeAttribute('allowfullscreen');
              // Re-add after a tick so any stale fullscreen state is cleared
              requestAnimationFrame(function () {
                els.videoFrame.setAttribute('allowfullscreen', 'true');
                els.videoFrame.setAttribute('webkitallowfullscreen', 'true');
                els.videoFrame.setAttribute('mozallowfullscreen', 'true');
              });
            }
          } catch (e) {}
        }
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenExit);
    document.addEventListener('webkitfullscreenchange', onFullscreenExit);
  }

  function handlePlayerMessage(event) {
    try {
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return;
        }
      }
      
      if (!data || typeof data !== 'object') return;

      // Handle MEDIA_DATA event for persistent progress tracking
      if (data.type === 'MEDIA_DATA' && data.data) {
        localStorage.setItem('peachifyProgress', JSON.stringify(data.data));
        localStorage.setItem('vidNestProgress', JSON.stringify(data.data));
        localStorage.setItem('vidUpProgress', JSON.stringify(data.data));
      }

      // Unwrap payload if nested
      let evData = data;
      if (data.type === "PLAYER_EVENT" && data.data) {
        evData = data.data;
      }

      // Parse current time and duration from either Videasy or Vidnest format
      const cTime = typeof evData.timestamp === 'number' ? evData.timestamp : evData.currentTime;
      const dur = evData.duration;

      if (typeof cTime === 'number' && typeof dur === 'number' && dur > 0) {
         const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
         const isAnimeKey = state.isAnime || state.type === 'anime';
         const key = `${state.type}_${state.id}${state.type === 'tv' || isAnimeKey ? `_${state.season}_${state.episode}` : ''}`;
         
         if (cTime > 0) {
           const progRatio = typeof evData.progress === 'number' ? evData.progress : Math.round((cTime / dur) * 100);
           progressData[key] = {
             currentTime: cTime,
             duration: dur,
             progress: progRatio,
             lastUpdated: Date.now()
           };
           localStorage.setItem('watchProgress', JSON.stringify(progressData));
         }
      }

      if (state.activeServer === 'videasy') {
         let episodeChanged = false;
         let currentType = state.type;
         
         if (state.isAnime && state.malId) {
             currentType = "anime";
         }

         if (currentType === 'tv' && typeof evData.season !== 'undefined' && typeof evData.episode !== 'undefined') {
             if (Number(evData.season) !== Number(state.season) || Number(evData.episode) !== Number(state.episode)) {
                 state.season = evData.season;
                 state.episode = evData.episode;
                 episodeChanged = true;
             }
         } else if (currentType === 'anime' && typeof evData.episode !== 'undefined') {
             if (Number(evData.episode) !== Number(state.episode)) {
                 state.episode = evData.episode;
                 episodeChanged = true;
             }
         }

         if (episodeChanged) {
             const url = new URL(window.location);
             if (state.type === 'tv') {
                 url.searchParams.set('season', state.season);
             }
             url.searchParams.set('episode', state.episode);
             window.history.replaceState({}, '', url);
             
             fetchDetails();
             loadPlayer(); 
         }
      }
    } catch (e) {
      console.error("Error handling player message:", e);
    }
  }

  function handleServerChange(e) {
    state.activeServer = e.target.value;
    localStorage.setItem('preferredServer', state.activeServer);
    loadPlayer();
    showToast(`Switched to ${els.serverSelect.options[els.serverSelect.selectedIndex].text}`);
  }

  function handleBack() {
    exitImmersiveMode();
    let url = `/media.html?type=${state.type}&id=${state.id}`;
    if (state.isAnime && state.malId) {
      url += `&anime=1&malId=${state.malId}`;
    }
    window.location.href = url;
  }

  async function fetchDetails() {
    try {
      let data;
      if (state.type === 'tv') {
        data = await TMDB.getTVDetails(state.id);
        els.title.textContent = `${data.name} - S${state.season} E${state.episode}`;
      } else {
        data = await TMDB.getMovieDetails(state.id);
        els.title.textContent = data.title || data.name;
      }
    } catch (err) {
      els.title.innerHTML = `ke1th.<span style="color: #e50914;">streams</span>`;
    }
  }

  function loadPlayer() {
    let playbackType = state.type;
    let playbackId = state.id;

    // Bad mappings override for specific shows on vidnest
    const overrideIds = [76479];
    if (playbackType === "tv" && overrideIds.includes(Number(playbackId)) && state.activeServer === "vidnest") {
      state.activeServer = "videasy";
      els.serverSelect.value = "videasy";
      showToast("Switched to fallback source due to known mapping issues.");
    }

    // Anime handling
    if (state.activeServer === "videasy" && state.isAnime && state.malId) {
      playbackType = "anime";
      playbackId = state.malId;
    }

    const src = buildServerUrl(state.activeServer, playbackType, playbackId, state.season, state.episode);
    els.videoFrame.src = src;

    // Cascade Fallback logic
    let fallbackTarget = null;
    let fallbackName = "";

    if (state.activeServer === "videasy") {
      fallbackTarget = "vidsrc";
      fallbackName = "Server 2";
    } else if (state.activeServer === "vidsrc") {
      fallbackTarget = "rive";
      fallbackName = "Server 3";
    } else if (state.activeServer === "rive") {
      fallbackTarget = "vidup";
      fallbackName = "Server 4";
    } else if (state.activeServer === "vidup") {
      fallbackTarget = "vixsrc";
      fallbackName = "Server 5";
    } else if (state.activeServer === "vixsrc") {
      fallbackTarget = "vidnest";
      fallbackName = "Server 6";
    } else if (state.activeServer === "vidnest") {
      fallbackTarget = "vidfast";
      fallbackName = "Server 7";
    } else if (state.activeServer === "vidfast") {
      fallbackTarget = "peachify";
      fallbackName = "Server 8";
    }

    if (fallbackTarget) {
      let fallbackTriggered = false;
      const triggerFallback = (reason) => {
        // Prevent double trigger or triggering if user manually switched already
        if (fallbackTriggered || state.activeServer === fallbackTarget || els.serverSelect.value !== state.activeServer) return;
        fallbackTriggered = true;
        console.warn(`${state.activeServer} fallback triggered: ${reason}`);
        state.activeServer = fallbackTarget;
        els.serverSelect.value = fallbackTarget;
        showToast(`Server unavailable. Switched to ${fallbackName}.`);
        loadPlayer();
      };

      const serverOrigin = new URL(src).origin;
      const controller = new AbortController();
      const networkTimeoutId = setTimeout(() => controller.abort(), 3000);
      
      fetch(serverOrigin, { mode: 'no-cors', signal: controller.signal })
        .then(() => clearTimeout(networkTimeoutId))
        .catch(() => triggerFallback('network_error'));

      let messageListener;
      let pingInterval;
      
      const messageTimeoutId = setTimeout(() => {
        window.removeEventListener('message', messageListener);
        if (pingInterval) clearInterval(pingInterval);
        
        if (state.activeServer === 'rive') {
          // Bypass timeout fallback for Rive as postMessage support is unverified
        } else if (state.activeServer === 'vixsrc') {
          // Intelligent 404 detection for Vixsrc: Vixsrc injects a sub-iframe if a movie is found.
          // If after 8 seconds there are 0 sub-frames, it means no source was found.
          try {
            if (els.videoFrame && els.videoFrame.contentWindow) {
              if (els.videoFrame.contentWindow.length === 0) {
                triggerFallback('vixsrc_no_sources_found');
              }
            }
          } catch (e) {
            // Fallback if cross-origin policy behaves unexpectedly
          }
        } else {
          triggerFallback('timeout_no_message');
        }
      }, 6500); // 6.5 seconds wait for internal scraping

      // Actively ask Vidfast for its status since it might not send events if autoplay is blocked
      if (state.activeServer === 'vidfast') {
        pingInterval = setInterval(() => {
          if (els.videoFrame && els.videoFrame.contentWindow) {
            els.videoFrame.contentWindow.postMessage({ command: 'getStatus' }, '*');
          }
        }, 1000);
      }

      const currentServerForListener = state.activeServer;

      messageListener = (event) => {
        if (state.activeServer !== currentServerForListener) {
            window.removeEventListener('message', messageListener);
            return;
        }

        let evtData = event.data;
        if (typeof evtData === 'string') {
          try { evtData = JSON.parse(evtData); } catch(e) {}
        }
        
        let isValidEvent = false;
        let isErrorEvent = false;

        if (evtData && typeof evtData === 'object') {
          if (evtData.type === 'PLAYER_EVENT' || evtData.type === 'MEDIA_DATA') isValidEvent = true;
          if (evtData.event === 'ready' || evtData.event === 'video_loaded') isValidEvent = true;
          if (typeof evtData.duration !== 'undefined' && typeof evtData.currentTime !== 'undefined') isValidEvent = true;
          
          if (state.activeServer === 'vidfast' && evtData.status !== undefined) isValidEvent = true;

          // Catch delayed player errors (e.g. video segments 404ing after player loads)
          if (evtData.event === 'error' || (evtData.data && evtData.data.event === 'error') || evtData.name === 'error' || evtData.status === 'error') {
            isErrorEvent = true;
          }
        } else if (typeof evtData === 'string' && evtData.toLowerCase() === 'ready') {
          isValidEvent = true;
        }
        
        if (isErrorEvent) {
          triggerFallback('player_error');
          window.removeEventListener('message', messageListener);
          return;
        }

        if (isValidEvent) {
          clearTimeout(messageTimeoutId);
          if (pingInterval) clearInterval(pingInterval);
          // We intentionally do NOT remove the message listener here.
          // We keep it alive to catch delayed player errors that occur after initialization.
        }
      };
      window.addEventListener('message', messageListener);
    }
  }

  function buildServerUrl(server, type, id, season, episode) {
    if (server === 'vidsrc') return buildVidsrcWikiUrl(type, id, season, episode);
    if (server === 'rive') return buildRiveUrl(type, id, season, episode);
    if (server === 'vidup') return buildVidUpUrl(type, id, season, episode);
    if (server === 'peachify') return buildPeachifyUrl(type, id, season, episode);
    if (server === 'vixsrc') return buildVixsrcUrl(type, id, season, episode);
    if (server === 'vidfast') return buildVidfastUrl(type, id, season, episode);
    if (server === 'vidnest') return buildVidnestUrl(type, id, season, episode);
    return buildVideasyUrl(type, id, season, episode);
  }

  function buildRiveUrl(type, id, season, episode) {
    const themeParams = "&theme=e50914&color=e50914&primaryColor=e50914";
    if (type === "tv" || type === "anime") {
      return `https://rivestream.vip/embed?type=tv&id=${id}&season=${season}&episode=${episode}${themeParams}`;
    }
    if (type === "movie") {
      return `https://rivestream.vip/embed?type=movie&id=${id}${themeParams}`;
    }
    return "";
  }

  function buildVidUpUrl(type, id, season, episode) {
    let progressParam = null;
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = Math.floor(progressData[key].currentTime);
      }
    } catch (err) {}

    const searchParams = new URLSearchParams();
    searchParams.set('theme', 'E50914');
    searchParams.set('sub', 'en');
    searchParams.set('poster', 'true');
    searchParams.set('title', 'true');
    searchParams.set('autoPlay', 'false');

    if (progressParam) searchParams.set('startAt', progressParam);
    
    if (type === "tv" || type === "anime") {
        searchParams.set('autoNext', 'true');
        searchParams.set('nextButton', 'true');
    }

    const mediaType = (type === "tv" || type === "anime") ? "tv" : "movie";
    
    if (mediaType === "tv") {
      return `https://vidup.to/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    return `https://vidup.to/movie/${id}?${searchParams.toString()}`;
  }

  function buildPeachifyUrl(type, id, season, episode) {
    let progressParam = null;
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = Math.floor(progressData[key].currentTime);
      }
    } catch (err) {}

    const searchParams = new URLSearchParams();
    searchParams.set('accent', 'E50914');
    searchParams.set('autoPlay', 'false');
    searchParams.set('dub', 'English');
    searchParams.set('sub', 'English');

    if (progressParam) searchParams.set('startAt', progressParam);
    if (type === 'tv' || type === 'anime') {
        searchParams.set('autoNext', '30');
    }

    if (type === "tv" || type === "anime") {
      return `https://peachify.top/embed/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    if (type === "movie") {
      return `https://peachify.top/embed/movie/${id}?${searchParams.toString()}`;
    }
    return "";
  }

  function buildVixsrcUrl(type, id, season, episode) {
    let progressParam = null;
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = Math.floor(progressData[key].currentTime);
      }
    } catch (err) {}

    const searchParams = new URLSearchParams();
    searchParams.set('primaryColor', 'e50914');
    searchParams.set('lang', 'eng');
    searchParams.set('sub', 'eng');
    searchParams.set('autoplay', 'false');

    if (type === "tv" || type === "anime") {
      if (progressParam) searchParams.set('startAt', progressParam);
      return `https://vixsrc.to/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    if (type === "movie") {
      if (progressParam) searchParams.set('startAt', progressParam);
      return `https://vixsrc.to/movie/${id}?${searchParams.toString()}`;
    }
    return "";
  }

  function buildVidfastUrl(type, id, season, episode) {
    let progressParam = null;
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = Math.floor(progressData[key].currentTime);
      }
    } catch (err) {}

    const searchParams = new URLSearchParams();
    searchParams.set('theme', 'e50914');
    searchParams.set('sub', 'en');
    searchParams.set('fullscreenButton', 'true');
    searchParams.set('poster', 'true');
    searchParams.set('title', 'true');
    searchParams.set('chromecast', 'true');

    if (type === "tv" || type === "anime") {
      if (progressParam) searchParams.set('startAt', progressParam);
      searchParams.set('nextButton', 'true');
      searchParams.set('autoNext', 'true');
      return `https://vidfast.pro/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    if (type === "movie") {
      if (progressParam) searchParams.set('startAt', progressParam);
      return `https://vidfast.pro/movie/${id}?${searchParams.toString()}`;
    }
    return "";
  }

  function buildVidnestUrl(type, id, season, episode) {
    let progressParam = null;
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = Math.floor(progressData[key].currentTime);
      }
    } catch (err) {}

    const searchParams = new URLSearchParams();

    if (type === "tv" || type === "anime") {
      if (progressParam) searchParams.set('progress', progressParam);
      return `https://vidnest.fun/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    if (type === "movie") {
      if (progressParam) searchParams.set('startAt', progressParam);
      return `https://vidnest.fun/movie/${id}?${searchParams.toString()}`;
    }
    return "";
  }

  function buildVidsrcWikiUrl(type, id, season, episode) {
    const searchParams = new URLSearchParams();
    searchParams.set('sub', 'en');
    searchParams.set('autoplay', '0');

    if (type === "tv" || type === "anime") {
      return `https://vidsrc.wiki/embed/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    if (type === "movie") {
      return `https://vidsrc.wiki/embed/movie/${id}?${searchParams.toString()}`;
    }
    return "";
  }

  function buildVideasyUrl(type, id, season, episode) {
    let progressParam = "";
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = `&progress=${Math.floor(progressData[key].currentTime)}`;
      }
    } catch (err) {}

    const params = `?color=e50914&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&autoplay=0&autoPlay=false&playsinline=1&playsInline=true&provider=yoru&server=yoru&sv=yoru&source=yoru${progressParam}`;

    if (type === "tv") {
      return `https://player.videasy.to/tv/${id}/${season}/${episode}${params}`;
    }
    if (type === "anime") {
      return `https://player.videasy.to/anime/${id}/${episode}${params}`;
    }
    if (type === "movie") {
      return `https://player.videasy.to/movie/${id}${params}`;
    }
    return "";
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 3000);
  }

  function initDisclaimer() {
    const modal = document.getElementById('disclaimerModal');
    const dontShow = document.getElementById('disclaimerDontShow');
    const okBtn = document.getElementById('disclaimerOk');

    if (localStorage.getItem('hideDisclaimer') === '1') {
      modal.classList.add('hidden');
      return;
    }

    modal.classList.remove('hidden');

    okBtn.addEventListener('click', function() {
      if (dontShow.checked) {
        localStorage.setItem('hideDisclaimer', '1');
      }
      modal.classList.add('hidden');
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
