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
    backBtn: document.getElementById('backBtn'),
    serverSelect: document.getElementById('serverSelect'),
    videoFrame: document.getElementById('videoFrame'),
    toast: document.getElementById('toast')
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

    // Try to lock orientation to landscape
    lockLandscape();

    els.serverSelect.value = state.activeServer;
    els.serverSelect.addEventListener('change', handleServerChange);
    els.backBtn.addEventListener('click', handleBack);
    
    window.addEventListener('message', handlePlayerMessage);

    fetchDetails();
    loadPlayer();
    initDisclaimer();
  }

  async function lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
      } else if (screen.lockOrientation) {
        screen.lockOrientation('landscape');
      } else if (screen.mozLockOrientation) {
        screen.mozLockOrientation('landscape');
      } else if (screen.msLockOrientation) {
        screen.msLockOrientation('landscape');
      }
    } catch (err) {
      console.warn("Screen orientation lock failed: ", err);
    }
  }

  function unlockOrientation() {
    try {
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock();
      } else if (screen.unlockOrientation) {
        screen.unlockOrientation();
      } else if (screen.mozUnlockOrientation) {
        screen.mozUnlockOrientation();
      } else if (screen.msUnlockOrientation) {
        screen.msUnlockOrientation();
      }
    } catch (err) {
      console.warn("Screen orientation unlock failed: ", err);
    }
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

      // Unwrap Videasy payload if nested
      const evData = (data && data.type === "PLAYER_EVENT" && data.data) ? data.data : data;

      if (typeof evData.progress === 'number' && typeof evData.timestamp === 'number') {
         const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
         const isAnimeKey = state.isAnime || state.type === 'anime';
         const key = `${state.type}_${state.id}${state.type === 'tv' || isAnimeKey ? `_${state.season}_${state.episode}` : ''}`;
         
         if (evData.timestamp > 0) {
           progressData[key] = {
             currentTime: evData.timestamp,
             duration: evData.duration || 0,
             progress: evData.progress,
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
    unlockOrientation();
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

    // Fallback logic for Default Server (videasy)
    if (state.activeServer === "videasy") {
      let fallbackTriggered = false;
      const triggerFallback = (reason) => {
        if (fallbackTriggered || state.activeServer !== "videasy") return;
        fallbackTriggered = true;
        console.warn(`Server 1 fallback triggered: ${reason}`);
        state.activeServer = "vidnest";
        els.serverSelect.value = "vidnest";
        showToast("Server 1 unavailable. Automatically switched to Server 2.");
        loadPlayer();
      };

      // 1. Network check (detects DNS errors, complete blockages)
      const serverOrigin = new URL(src).origin;
      const controller = new AbortController();
      const networkTimeoutId = setTimeout(() => controller.abort(), 6000);
      
      fetch(serverOrigin, { mode: 'no-cors', signal: controller.signal })
        .then(() => clearTimeout(networkTimeoutId))
        .catch(() => triggerFallback('network_error'));

      // 2. Message timeout (detects HTTP 500/404, or broken player)
      let messageListener;
      const messageTimeoutId = setTimeout(() => {
        window.removeEventListener('message', messageListener);
        triggerFallback('timeout_no_message');
      }, 12000); // 12 seconds wait for player to initialize

      messageListener = (event) => {
        if (event.origin === serverOrigin) {
          clearTimeout(messageTimeoutId);
          window.removeEventListener('message', messageListener);
        }
      };
      window.addEventListener('message', messageListener);
    }
  }

  function buildServerUrl(server, type, id, season, episode) {
    if (server === 'vidnest') {
      return buildVidnestUrl(type, id, season, episode);
    }
    return buildVideasyUrl(type, id, season, episode);
  }

  function buildVidnestUrl(type, id, season, episode) {
    let progressParam = "";
    try {
      const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
      const isAnimeKey = type === 'anime';
      const key = `${type}_${id}${type === 'tv' || isAnimeKey ? `_${season}_${episode}` : ''}`;
      if (progressData[key] && progressData[key].currentTime) {
        progressParam = `?startAt=${Math.floor(progressData[key].currentTime)}`;
      }
    } catch (err) {}

    let q = progressParam;

    if (type === "tv" || type === "anime") {
      if (q) {
        q = q.replace('startAt=', 'progress=');
      }
      return `https://vidnest.fun/tv/${id}/${season}/${episode}${q}`;
    }
    if (type === "movie") {
      return `https://vidnest.fun/movie/${id}${q}`;
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

    const params = `?color=e50914&nextEpisode=true&autoplayNextEpisode=true&episodeSelector=true&overlay=true&autoplay=1&autoPlay=true&playsinline=1&playsInline=true${progressParam}`;

    if (type === "tv") {
      return `https://player.videasy.net/tv/${id}/${season}/${episode}${params}`;
    }
    if (type === "anime") {
      return `https://player.videasy.net/anime/${id}/${episode}${params}`;
    }
    if (type === "movie") {
      return `https://player.videasy.net/movie/${id}${params}`;
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
