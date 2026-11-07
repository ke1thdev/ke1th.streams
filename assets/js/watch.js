(async function() {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedType = urlParams.get('type');
  const type = requestedType === 'anime' ? 'tv' : requestedType;
  const id = urlParams.get('id');
  const requestedSeason = Number.parseInt(urlParams.get('season'), 10);
  const season = Number.isInteger(requestedSeason) && requestedSeason >= 0 ? requestedSeason : 1;
  const episode = Math.max(1, Number.parseInt(urlParams.get('episode') ?? '1', 10) || 1);
  const requestedMalId = urlParams.get('malId');
  const malId = /^\d+$/.test(requestedMalId || '') ? requestedMalId : null;
  const isAnime = requestedType === 'anime' || urlParams.get('anime') === '1';
  const servers = ['videasy', 'vidsrc', 'rive', 'vidup', 'vixsrc', 'vidnest', 'vidfast', 'peachify'];

  const els = {
    title: document.getElementById('watchTitle'),
    header: document.querySelector('.watch-header'),
    backBtn: document.getElementById('backBtn'),
    serverSelect: document.getElementById('serverSelect'),
    videoFrame: document.getElementById('videoFrame'),
    toast: document.getElementById('toast'),
    tapInterceptor: document.getElementById('tapInterceptor'),
    nextEpBtn: document.getElementById('nextEpBtn'),
    autoNextControl: document.getElementById('autoNextControl'),
    autoNextToggle: document.getElementById('autoNextToggle'),
    markFinishedBtn: document.getElementById('markFinishedBtn'),
    watchStatus: document.getElementById('watchStatus')
  };

  const preferredServer = readPreference('preferredServer');
  const state = {
    type,
    id,
    season,
    episode,
    malId,
    isAnime,
    activeServer: servers.includes(preferredServer) ? preferredServer : 'videasy',
    autoNext: readPreference('autoNextEpisode') !== 'false',
    nextEpisodeInfo: null
  };

  let activePlayer = null;
  let episodePlayback = { ended: false, nearEnd: false, queued: false };
  let progressSample = null;
  let progressTimer = null;

  function readPreference(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function savePreference(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The player still works when the browser blocks storage.
    }
  }

  function currentMedia() {
    return { type: state.type, id: state.id, season: state.season, episode: state.episode, isAnime: state.isAnime, malId: state.malId };
  }

  function init() {
    if (!['movie', 'tv'].includes(state.type) || !/^\d+$/.test(state.id || '') || Number(state.id) < 1) {
      window.location.href = './';
      return;
    }

    // Listen for fullscreen changes so orientation locks when user goes fullscreen
    // via the iframe player's own fullscreen button
    LandscapeForcer.init();

    els.serverSelect.value = state.activeServer;
    els.serverSelect.addEventListener('change', handleServerChange);
    els.backBtn.addEventListener('click', handleBack);
    if (els.nextEpBtn) els.nextEpBtn.addEventListener('click', playNextEpisode);
    if (els.markFinishedBtn) els.markFinishedBtn.addEventListener('click', markFinished);
    if (state.type === 'tv' && els.autoNextToggle) {
      els.autoNextControl?.classList.remove('hidden');
      els.autoNextToggle.checked = state.autoNext;
      els.autoNextToggle.addEventListener('change', () => {
        state.autoNext = els.autoNextToggle.checked;
        savePreference('autoNextEpisode', String(state.autoNext));
        syncEpisodeControls();
      });
    }
    setupFloatingBackBtn();
    setupGlassOverlay();
    setupFullscreenSync();
    
    window.addEventListener('message', handlePlayerMessage);
    window.addEventListener('pagehide', flushProgress);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushProgress();
      else syncEpisodeControls();
    });

    WatchHistory.start(currentMedia());
    updateWatchStatus();
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

  // ─── Floating Glass Overlay (Global) ───
  // Auto-hides the header after 3 seconds, re-appears on any screen tap/move.
  // Uses a transparent tap-interceptor div that sits over the iframe
  // because clicks inside an iframe don't bubble to the parent document.
  function setupGlassOverlay() {
    if (!els.header || !els.tapInterceptor) return;

    let hideTimer = null;

    function showOverlay() {
      els.header.classList.remove('glass-hidden');
      if (!els.videoFrame.classList.contains('zoomed-fill')) {
          els.tapInterceptor.classList.remove('active');
      }
      resetHideTimer();
    }

    function hideOverlay() {
      els.header.classList.add('glass-hidden');
      els.tapInterceptor.classList.add('active');
    }

    function resetHideTimer() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideOverlay, 3000);
    }

    // Start the initial auto-hide timer
    resetHideTimer();

    // Interaction on the interceptor → show overlay, double-tap zoom, pinch-zoom
    let lastTap = 0;
    let initialPinchDist = 0;

    const toggleZoom = function() {
        els.videoFrame.classList.toggle('zoomed-fill');
        if (els.videoFrame.classList.contains('zoomed-fill')) {
            els.tapInterceptor.classList.add('active');
        } else if (!els.header.classList.contains('glass-hidden')) {
            els.tapInterceptor.classList.remove('active');
        } else {
            els.tapInterceptor.classList.add('active');
        }
    };

    const handleTouchStart = function (e) {
      if (e.touches.length === 2) {
          if (e.cancelable) e.preventDefault();
          initialPinchDist = Math.hypot(
              e.touches[0].pageX - e.touches[1].pageX,
              e.touches[0].pageY - e.touches[1].pageY
          );
          return;
      }
    };

    const handleTouchMove = function(e) {
      if (e.touches.length === 2 && initialPinchDist > 0) {
          if (e.cancelable) e.preventDefault();
          const currentDist = Math.hypot(
              e.touches[0].pageX - e.touches[1].pageX,
              e.touches[0].pageY - e.touches[1].pageY
          );
          if (currentDist > initialPinchDist + 40) {
              if (!els.videoFrame.classList.contains('zoomed-fill')) toggleZoom();
          } else if (currentDist < initialPinchDist - 40) {
              if (els.videoFrame.classList.contains('zoomed-fill')) toggleZoom();
          }
      }
    };

    const handleTouchEnd = function(e) {
       if (!e.touches || e.touches.length < 2) {
           initialPinchDist = 0;
       }
    };

    els.tapInterceptor.addEventListener('dblclick', function(e) {
       e.preventDefault();
       toggleZoom();
    });

    els.tapInterceptor.addEventListener('click', function(e) {
      e.preventDefault();
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;
      
      if (tapLength < 350 && tapLength > 0) {
          toggleZoom();
          lastTap = 0;
      } else {
          showOverlay();
          lastTap = currentTime;
      }
    });
    
    els.tapInterceptor.addEventListener('touchstart', handleTouchStart, { passive: false });
    els.tapInterceptor.addEventListener('touchmove', handleTouchMove, { passive: false });
    els.tapInterceptor.addEventListener('touchend', handleTouchEnd);
    
    // Mouse movement also triggers it on desktop
    els.tapInterceptor.addEventListener('mousemove', function (e) {
      showOverlay();
    });

    // Interaction on header controls → reset the timer
    els.header.addEventListener('click', function (e) {
      resetHideTimer();
    });
    
    els.header.addEventListener('touchstart', function (e) {
      resetHideTimer();
    }, { passive: true });
    
    els.header.addEventListener('mousemove', function (e) {
      resetHideTimer();
    });

    els.serverSelect.addEventListener('change', function () {
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

  function parsePlayerMessage(event) {
    if (event.source !== els.videoFrame.contentWindow || !activePlayer?.origins.has(event.origin)) return null;
    if (typeof event.data !== 'string') return event.data;
    try {
      return JSON.parse(event.data);
    } catch {
      return event.data.toLowerCase() === 'ready' ? { event: 'ready' } : null;
    }
  }

  function handlePlayerMessage(event) {
    const message = parsePlayerMessage(event);
    if (!message || typeof message !== 'object') return;

    const player = activePlayer;
    player.observe(message);
    if (player !== activePlayer || message.type === 'MEDIA_DATA') return;

    const payload = message.data && typeof message.data === 'object' ? message.data : message;
    const timing = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const eventName = String(payload.event || message.event || payload.name || message.name || message.type || '')
      .toLowerCase().replace(/[_-]/g, '');
    const currentTime = Number.isFinite(timing.currentTime) ? timing.currentTime : timing.timestamp;
    const duration = timing.duration;
    const hasTiming = Number.isFinite(currentTime) && Number.isFinite(duration)
      && currentTime > 0 && duration > 0 && currentTime <= duration + 1;
    const ended = ['ended', 'videoended', 'playbackended', 'playbackend'].includes(eventName);
    const atEnd = hasTiming && duration - currentTime <= 0.25
      && ['', 'playerevent', 'timeupdate', 'progress'].includes(eventName);

    if (ended || atEnd) {
      if (episodePlayback.ended) return;
      flushProgress();
      episodePlayback.ended = true;
      episodePlayback.nearEnd = true;
      WatchHistory.finish(currentMedia(), hasTiming ? { currentTime, duration } : undefined);
      updateWatchStatus();
      syncEpisodeControls();
      return;
    }

    if (!hasTiming || episodePlayback.ended) return;

    const progress = Math.min(100, (currentTime / duration) * 100);
    progressSample = { currentTime, duration, progress };
    const nearEnd = progress >= 95;
    const crossedThreshold = nearEnd !== episodePlayback.nearEnd;
    if (crossedThreshold || ['pause', 'seeked'].includes(eventName)) {
      flushProgress();
    } else if (progressTimer === null) {
      progressTimer = setTimeout(flushProgress, 1000);
    }
    episodePlayback.nearEnd = nearEnd;
    if (crossedThreshold) syncEpisodeControls();
  }

  function flushProgress() {
    clearTimeout(progressTimer);
    progressTimer = null;
    if (!progressSample) return;
    WatchHistory.update(currentMedia(), progressSample);
    progressSample = null;
    updateWatchStatus();
  }

  function updateWatchStatus() {
    const status = WatchHistory.get(currentMedia())?.status;
    if (els.watchStatus) {
      const label = status === 'finished' ? 'Finished' : status === 'watching' ? 'In progress' : '';
      if (els.watchStatus.textContent !== label) els.watchStatus.textContent = label;
      els.watchStatus.classList.toggle('hidden', !label);
      els.watchStatus.dataset.status = status || '';
    }
    els.markFinishedBtn?.classList.toggle('hidden', status === 'finished');
  }

  function markFinished() {
    flushProgress();
    WatchHistory.finish(currentMedia());
    episodePlayback.nearEnd = true;
    updateWatchStatus();
    syncEpisodeControls();
  }

  function syncEpisodeControls() {
    const next = state.nextEpisodeInfo;
    if (els.nextEpBtn) {
      els.nextEpBtn.classList.toggle('hidden', !next);
      els.nextEpBtn.classList.toggle('visible', Boolean(next));
      els.nextEpBtn.toggleAttribute('data-near-end', episodePlayback.nearEnd);
      if (next) {
        els.nextEpBtn.setAttribute('aria-label', `Next episode: Season ${next.season}, Episode ${next.episode}`);
        const label = els.nextEpBtn.querySelector('#nextEpLabel');
        if (label) label.textContent = `Next · E${next.episode}`;
      }
    }

    if (!next) return;
    if (episodePlayback.nearEnd && !episodePlayback.queued) {
      WatchHistory.queue({ ...currentMedia(), ...next });
      episodePlayback.queued = true;
    }
    if (episodePlayback.ended && state.autoNext && !document.hidden) playNextEpisode();
  }

  function handleServerChange(e) {
    if (!servers.includes(e.target.value)) return;
    flushProgress();
    state.activeServer = e.target.value;
    savePreference('preferredServer', state.activeServer);
    loadPlayer();
    showToast(`Switched to ${els.serverSelect.options[els.serverSelect.selectedIndex].text}`);
  }

  function handleBack() {
    flushProgress();
    exitImmersiveMode();
    let url = `media.html?type=${state.type}&id=${state.id}`;
    if (state.isAnime && state.malId) {
      url += `&anime=1&malId=${state.malId}`;
    }
    window.location.href = url;
  }

  async function fetchDetails() {
    try {
      state.details = state.type === 'tv' ? await TMDB.getTVDetails(state.id) : await TMDB.getMovieDetails(state.id);
      const artwork = state.details.backdrop_path || state.details.poster_path;
      const backdrop = document.getElementById('watchToolsBackdrop');
      if (backdrop && typeof artwork === 'string' && /^\/[\w.-]+$/.test(artwork)) {
        const base = window.TMDB_CONFIG?.BACKDROP_BASE || 'https://image.tmdb.org/t/p/original';
        backdrop.style.setProperty('--watch-artwork', `url("${base}${artwork}")`);
      }
      renderEpisode();
    } catch {
      els.title.textContent = 'ke1th.streams';
    }
  }

  function renderEpisode() {
    const details = state.details;
    if (!details) return;

    if (state.type === 'tv') {
      els.title.textContent = `${details.name} · S${state.season} E${state.episode}`;
      state.nextEpisodeInfo = findNextEpisode(details);
    } else {
      els.title.textContent = details.title || details.name;
    }
    syncEpisodeControls();
  }

  function findNextEpisode(details) {
    const upcoming = details.next_episode_to_air;
    const today = new Date().toISOString().slice(0, 10);
    const available = next => !upcoming || !upcoming.air_date || upcoming.air_date <= today
      || next.season !== upcoming.season_number || next.episode !== upcoming.episode_number;

    if (state.isAnime && state.season === 1) {
      const next = { season: 1, episode: state.episode + 1 };
      return next.episode <= details.number_of_episodes && available(next) ? next : null;
    }

    const seasons = details.seasons || [];
    const seasonDetails = seasons.find(item => item.season_number === state.season);
    if (!seasonDetails) return null;
    if (state.episode < seasonDetails.episode_count) {
      const next = { season: state.season, episode: state.episode + 1 };
      return available(next) ? next : null;
    }

    const following = seasons.filter(item => item.season_number > state.season && item.episode_count > 0
      && (!item.air_date || item.air_date <= today)).sort((a, b) => a.season_number - b.season_number)[0];
    if (!following) return null;
    const next = { season: following.season_number, episode: 1 };
    return available(next) ? next : null;
  }

  function playNextEpisode() {
    const next = state.nextEpisodeInfo;
    if (!next) return;

    flushProgress();
    if (!episodePlayback.queued) WatchHistory.queue({ ...currentMedia(), ...next });
    state.nextEpisodeInfo = null;
    state.season = next.season;
    state.episode = next.episode;
    episodePlayback = { ended: false, nearEnd: false, queued: false };

    const url = new URL(window.location);
    url.searchParams.set('season', state.season);
    url.searchParams.set('episode', state.episode);
    window.history.replaceState({}, '', url);
    renderEpisode();
    updateWatchStatus();
    loadPlayer(true);
    showToast(`Opening S${state.season} E${state.episode}…`);
  }

  function loadPlayer(autoplay = false) {
    activePlayer?.cleanup();

    // Avoid the known VidNest mapping issue for this show.
    if (state.type === 'tv' && Number(state.id) === 76479 && state.activeServer === 'vidnest') {
      state.activeServer = 'videasy';
      els.serverSelect.value = state.activeServer;
      showToast('Switched to fallback source due to known mapping issues.');
    }

    const server = state.activeServer;
    const animeSource = server === 'videasy' && state.type === 'tv' && state.isAnime && state.malId;
    const src = new URL(buildServerUrl(server, animeSource ? 'anime' : state.type,
      animeSource ? state.malId : state.id, state.season, state.episode));
    if (autoplay) {
      // Keep provider-side episode navigation off. The app owns the episode and history.
      if (src.searchParams.has('autoPlay')) src.searchParams.set('autoPlay', 'true');
      if (src.searchParams.has('autoplay')) src.searchParams.set('autoplay', '1');
    }

    // A fresh browsing context prevents late messages from the previous episode
    // (including on the same provider) from being attributed to this one.
    const frame = els.videoFrame.cloneNode(false);
    frame.src = src.href;
    els.videoFrame.replaceWith(frame);
    els.videoFrame = frame;

    const origins = new Set([src.origin]);
    if (server === 'vidfast') origins.add('https://vidfast.vc');
    const fallback = servers[servers.indexOf(server) + 1];
    const controller = new AbortController();
    let networkTimeout;
    let messageTimeout;
    let pingInterval;

    function stopChecks() {
      clearTimeout(networkTimeout);
      clearTimeout(messageTimeout);
      clearInterval(pingInterval);
    }

    const player = {
      origins,
      cleanup() {
        stopChecks();
        controller.abort();
      },
      observe(message) {
        const data = message.data;
        if (message.event === 'error' || data?.event === 'error' || message.name === 'error' || message.status === 'error') {
          triggerFallback('player_error');
          return;
        }
        const hasTiming = payload => payload && Number.isFinite(payload.duration)
          && (Number.isFinite(payload.currentTime) || Number.isFinite(payload.timestamp));
        if (['PLAYER_EVENT', 'MEDIA_DATA'].includes(message.type)
          || ['ready', 'video_loaded'].includes(message.event) || hasTiming(message)
          || hasTiming(data) || (server === 'vidfast' && message.status !== undefined)) {
          stopChecks();
          controller.abort();
        }
      }
    };
    activePlayer = player;

    function triggerFallback(reason) {
      if (activePlayer !== player || !fallback) return;
      console.warn(`${server} fallback triggered: ${reason}`);
      state.activeServer = fallback;
      els.serverSelect.value = fallback;
      showToast(`Server unavailable. Switched to ${els.serverSelect.selectedOptions[0]?.text || 'the next server'}.`);
      loadPlayer(autoplay);
    }

    if (!fallback) return;
    let checkingNetwork = true;
    networkTimeout = setTimeout(() => {
      if (checkingNetwork && !controller.signal.aborted) triggerFallback('network_timeout');
    }, 3000);
    fetch(src.origin, { mode: 'no-cors', signal: controller.signal })
      .catch(() => {
        if (!controller.signal.aborted) triggerFallback('network_error');
      })
      .finally(() => {
        checkingNetwork = false;
        clearTimeout(networkTimeout);
      });

    messageTimeout = setTimeout(() => {
      clearInterval(pingInterval);
      if (server === 'rive') return; // Its player message API is unverified.
      if (server !== 'vixsrc' || frame.contentWindow?.length === 0) triggerFallback('timeout_no_message');
    }, 6500);

    if (server === 'vidfast') {
      pingInterval = setInterval(() => {
        for (const origin of origins) frame.contentWindow?.postMessage({ command: 'getStatus' }, origin);
      }, 1000);
    }
  }

  function resumeAt() {
    const saved = WatchHistory.get(currentMedia());
    return saved && saved.status !== 'finished' ? Math.floor(saved.currentTime || 0) : 0;
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
    const progressParam = resumeAt();

    const searchParams = new URLSearchParams();
    searchParams.set('theme', 'E50914');
    searchParams.set('sub', 'en');
    searchParams.set('poster', 'true');
    searchParams.set('title', 'true');
    searchParams.set('autoPlay', 'false');

    if (progressParam) searchParams.set('startAt', progressParam);
    
    if (type === "tv" || type === "anime") {
        searchParams.set('autoNext', 'false');
        searchParams.set('nextButton', 'false');
    }

    const mediaType = (type === "tv" || type === "anime") ? "tv" : "movie";
    
    if (mediaType === "tv") {
      return `https://vidup.to/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    return `https://vidup.to/movie/${id}?${searchParams.toString()}`;
  }

  function buildPeachifyUrl(type, id, season, episode) {
    const progressParam = resumeAt();

    const searchParams = new URLSearchParams();
    searchParams.set('accent', 'E50914');
    searchParams.set('autoPlay', 'false');
    searchParams.set('dub', 'English');
    searchParams.set('sub', 'English');

    if (progressParam) searchParams.set('startAt', progressParam);
    if (type === 'tv' || type === 'anime') {
        searchParams.set('autoNext', 'false');
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
    const progressParam = resumeAt();

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
    const progressParam = resumeAt();

    const searchParams = new URLSearchParams();
    searchParams.set('theme', 'e50914');
    searchParams.set('sub', 'en');
    searchParams.set('fullscreenButton', 'true');
    searchParams.set('poster', 'true');
    searchParams.set('title', 'true');
    searchParams.set('chromecast', 'true');

    if (type === "tv" || type === "anime") {
      if (progressParam) searchParams.set('startAt', progressParam);
      searchParams.set('nextButton', 'false');
      searchParams.set('autoNext', 'false');
      return `https://vidfast.pro/tv/${id}/${season}/${episode}?${searchParams.toString()}`;
    }
    if (type === "movie") {
      if (progressParam) searchParams.set('startAt', progressParam);
      return `https://vidfast.pro/movie/${id}?${searchParams.toString()}`;
    }
    return "";
  }

  function buildVidnestUrl(type, id, season, episode) {
    const progressParam = resumeAt();

    const searchParams = new URLSearchParams();

    if (type === "tv" || type === "anime") {
      if (progressParam) searchParams.set('progress', progressParam);
      searchParams.set('prevepisode', 'false');
      searchParams.set('nextepisode', 'false');
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
    const resume = resumeAt();
    const progressParam = resume ? `&progress=${resume}` : "";

    const params = `?color=e50914&nextEpisode=false&autoplayNextEpisode=false&episodeSelector=false&overlay=true&autoplay=0&autoPlay=false&playsinline=1&playsInline=true&provider=yoru&server=yoru&sv=yoru&source=yoru${progressParam}`;

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

    if (readPreference('hideDisclaimer') === '1') {
      modal.classList.add('hidden');
      return;
    }

    modal.classList.remove('hidden');

    okBtn.addEventListener('click', function() {
      if (dontShow.checked) {
        savePreference('hideDisclaimer', '1');
      }
      modal.classList.add('hidden');
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
