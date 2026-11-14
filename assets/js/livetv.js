(() => {
  const catalogRevision = document.currentScript?.src ? new URL(document.currentScript.src).search : '';
  const initLiveTV = () => {
  const grid = document.getElementById('livetvGrid');
  const videoPlayer = document.getElementById('liveVideoPlayer');
  const videoContainer = document.getElementById('videoContainer');
  const youtubeContainer = document.getElementById('liveYouTubeContainer');
  const radioContainer = document.getElementById('liveRadioContainer');
  const radioPlayer = document.getElementById('liveRadioPlayer');
  const radioLogo = document.getElementById('inlineRadioLogo');
  const playerTitle = document.getElementById('inlinePlayerTitle');
  const playerLogo = document.getElementById('inlinePlayerLogo');
  const playerSection = document.getElementById('liveTvPlayerSection');
  const playerStatus = document.getElementById('liveTvPlayerStatus');
  const workspace = document.getElementById('liveTvWorkspace');
  const categoryFilter = document.getElementById('categoryFilter');
  const searchInput = document.getElementById('liveTvSearchInput');
  const channelCount = document.getElementById('channelCount');
  const guideState = document.getElementById('liveTvGuideState');
  const guideMessage = document.getElementById('liveTvGuideMessage');
  const guideAction = document.getElementById('liveTvGuideAction');
  const moreChannels = document.getElementById('moreLiveTvChannels');
  const guideTitle = document.querySelector('.livetv-page-heading h1');

  let shakaInstance = null;
  let shakaReady = null;
  let allChannels = [];
  let activeChannel = null;
  const channelCards = new Map();
  let tuneRequest = 0;
  let toastTimer;
  let youtubeApiPromise;
  let youtubeSession = null;
  let nativeRequest = null;
  let nativeStartupTimer;
  let radioRequest = null;
  let nativeSession = null;
  let pageSuspended = false;
  const recovery = window.LivePlaybackRecovery?.create({
    isCurrent: session => nativeSession === session && session.request === tuneRequest &&
      activeChannel === session.channel && !playerSection.hidden,
    snapshot: () => ({ time: videoPlayer.currentTime, paused: videoPlayer.paused,
      visible: !document.hidden && !pageSuspended, online: navigator.onLine }),
    onStatus: setPlayerStatus,
    reload: session => {
      session.request = ++tuneRequest;
      stopNativePlayback();
      return playNativeChannel(session.channel, session.request, session);
    },
    onExhausted: session => showNativeError(session.channel, session.request,
      'Stream unavailable · Select again to retry', false)
  });

  // Toast Notification System
  function showToast(message) {
    const toast = document.getElementById('playerToast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  }

  // Initialize only after a channel is selected, with media setup deferred to load().
  let ui = null;
  function initShakaUI() {
    if (!shakaReady && typeof shaka !== 'undefined') {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        showToast('Your browser does not support this stream.');
        return;
      }

      shakaReady = (async () => {
        shakaInstance = new shaka.Player();
        await shakaInstance.attach(videoPlayer, false);
        ui = new shaka.ui.Overlay(shakaInstance, videoContainer, videoPlayer);
        const config = {
          controlPanelElements: ['play_pause', 'time_and_duration', 'spacer', 'mute', 'volume', 'quality', 'fullscreen'],
          addSeekBar: true,
        };
        ui.configure(config);

        const playerConfig = {
          manifest: {
            retryParameters: { maxAttempts: 3, timeout: 15000, connectionTimeout: 8000, stallTimeout: 5000 },
            dash: {
              ignoreMinBufferTime: true,
              ignoreSuggestedPresentationDelay: true,
              clockSyncUri: 'https://time.akamai.com/?iso'
            },
            hls: {
              ignoreTextStreamFailures: true,
              ignoreManifestProgramDateTime: true
            }
          },
          streaming: {
            lowLatencyMode: false,
            inaccurateManifestTolerance: 5,
            rebufferingGoal: 3,
            bufferingGoal: 20,
            retryParameters: { maxAttempts: 3, timeout: 15000, connectionTimeout: 8000, stallTimeout: 5000 },
          }
        };
        shakaInstance.configure(playerConfig);

        shakaInstance.addEventListener('error', event => {
          const codes = shaka.util.Error.Code;
          if (event.detail?.code === codes.LOAD_INTERRUPTED || event.detail?.code === codes.OPERATION_ABORTED) return;
          console.error('Shaka Error:', event.detail);
          // Shaka already retries recoverable live-network errors. Escalate
          // terminal failures; the watchdog handles persistent buffering.
          if (nativeRequest === tuneRequest && event.detail?.severity === shaka.util.Error.Severity.CRITICAL) {
            showNativeError(activeChannel, nativeRequest, 'Stream unavailable',
              event.detail.category !== shaka.util.Error.Category.DRM);
          }
        });
      })().catch(async error => {
        await ui?.destroy().catch(() => {});
        await shakaInstance?.destroy().catch(() => {});
        ui = null;
        shakaInstance = null;
        shakaReady = null;
        throw error;
      });
    }
    return shakaReady;
  }

  const PH_CHANNELS = [
    'A2Z', 'GMA 7', 'GMA Life TV', 'GMA Pinoy TV', 'Kapamilya Channel', 'TV5', 'IBC 13', 'PTV',
    'TVN Movies (Tagalog)', 'Solar', 'PIE', 'One PH', 'GTV', 'Cinemax', 'HBO'
  ].map(name => name.toLowerCase());
  const BATCH_SIZE = 30;
  let filteredChannels = [];
  let visibleCount = 0;

  function setGuideState(message, action = '') {
    guideState.hidden = !message;
    guideMessage.textContent = message;
    guideAction.textContent = action;
    guideAction.hidden = !action;
  }

  async function fetchChannels() {
    grid.setAttribute('aria-busy', 'true');
    channelCount.textContent = 'Loading channels…';
    setGuideState('Loading the channel guide…');

    try {
      const response = await fetch('channels/channels.json' + catalogRevision);
      if (!response.ok) throw new Error('Channel guide request failed.');
      const data = await response.json();

      allChannels = data.map(ch => {
        return {
          name: ch.name,
          shareName: ch.name,
          group: ch.category || ch.group || 'General',
          logo: ch.logo,
          logoBackground: ch.logoBackground,
          url: ch.streamUrl || ch.url,
          type: ch.type || 'TV',
          genre: ch.genre || ch.radioGenre || '',
          aliases: Array.isArray(ch.aliases) ? ch.aliases : [],
          drm: ch.drm,
          youtubeLiveEndpoint: ch.youtubeLiveEndpoint
        };
      }).filter(channel => typeof channel.url === 'string' && channel.url.trim());

      allChannels.sort((a, b) => Number(isPhChannel(b.name)) - Number(isPhChannel(a.name)) || a.name.localeCompare(b.name));
      const categoryOrder = ['News', 'Entertainment', 'Movies', 'Kids & Cartoons',
        'Anime', 'Sports', 'Music', 'Radio', 'Documentary', 'Lifestyle & Travel', 'Faith & Worship',
        'Education', 'Korean & Drama', 'General'];
      const categories = Array.from(new Set(allChannels.map(channel => channel.group)))
        .sort((a, b) => (categoryOrder.indexOf(a) < 0 ? 99 : categoryOrder.indexOf(a))
          - (categoryOrder.indexOf(b) < 0 ? 99 : categoryOrder.indexOf(b)) || a.localeCompare(b));
      for (const category of categories) categoryFilter.add(new Option(category, category));
      categoryFilter.disabled = false;
      searchInput.disabled = false;

      const sharedName = new URLSearchParams(location.search).get('ch')?.toLowerCase();
      if (!sharedName) {
        filterChannels();
        return;
      }
      const previousNames = {
        'cartoon network': 'cartoon network asia',
        'adult swim': 'cartoon network / adult swim (us)'
      };
      const targetName = Object.hasOwn(previousNames, sharedName) ? previousNames[sharedName] : sharedName;
      const channel = allChannels.find(item =>
        item.shareName.toLowerCase() === targetName || item.name.toLowerCase() === targetName
        || item.aliases.some(alias => alias.toLowerCase() === targetName));
      if (channel && channel.type === 'Radio') categoryFilter.value = channel.group;
      filterChannels();
      if (channel) playChannel(channel, false);
    } catch (error) {
      console.error('Error fetching channels:', error);
      channelCount.textContent = 'Guide unavailable';
      setGuideState('The channel guide could not load.', 'Try again');
    } finally {
      grid.setAttribute('aria-busy', 'false');
    }
  }

  function setChannelLogo(well, channel, lazy = true) {
    const fallback = () => {
      const label = document.createElement('span');
      label.className = 'channel-logo-fallback';
      const words = (channel.name.match(/[\p{L}\p{N}]+/gu) || []).filter(word => !/^\d+$/.test(word));
      label.textContent = (words.length > 1
        ? words.slice(0, 3).map(word => word[0]).join('')
        : (words[0] || 'TV').slice(0, 3)).toUpperCase();
      well.replaceChildren(label);
    };

    if (!channel.logo) {
      fallback();
      return;
    }

    const logo = document.createElement('img');
    logo.className = 'channel-logo';
    logo.classList.toggle('channel-logo-dark', channel.logoBackground === 'dark');
    logo.alt = '';
    logo.loading = lazy ? 'lazy' : 'eager';
    logo.decoding = 'async';
    logo.addEventListener('error', () => {
      if (logo.parentNode === well) fallback();
    }, { once: true });
    logo.src = channel.logo;
    well.replaceChildren(logo);
  }

  function isPhChannel(name) {
    const lowerName = name.toLowerCase();
    return PH_CHANNELS.some(ph => lowerName.includes(ph) || ph.includes(lowerName));
  }

  function filterChannels() {
    const category = categoryFilter.value;
    const query = searchInput.value.trim().toLowerCase();
    filteredChannels = allChannels.filter(channel => (category === 'All' || channel.group === category)
      && [channel.name, channel.group, channel.genre, ...channel.aliases].some(value => value.toLowerCase().includes(query)));
    const count = filteredChannels.length;
    const radios = filteredChannels.filter(channel => channel.type === 'Radio').length;
    const television = count - radios;
    channelCount.textContent = [television && `${television} TV`, radios && `${radios} radio`]
      .filter(Boolean).join(' · ') || '0 results';
    guideTitle.textContent = category === 'Radio' ? 'Radio' : 'Live TV';
    setGuideState(count ? '' : 'No channels match these filters.', count ? '' : 'Clear filters');
    visibleCount = 0;
    channelCards.clear();
    grid.replaceChildren();
    renderBatch();
    batchObserver?.unobserve(moreChannels);
    if (!moreChannels.hidden) batchObserver?.observe(moreChannels);
  }

  function renderBatch() {
    const batch = filteredChannels.slice(visibleCount, visibleCount + BATCH_SIZE);
    const rows = document.createDocumentFragment();

    for (const channel of batch) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'channel-card';
      card.setAttribute('aria-pressed', String(channel === activeChannel));
      card.innerHTML = `
        <span class="channel-logo-wrap" aria-hidden="true"></span>
        <span class="channel-info"><span class="channel-name"></span><span class="channel-group"></span></span>
        <svg class="channel-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      `;
      card.querySelector('.channel-name').textContent = channel.name;
      const limited = channel.drm || channel.url.includes('prox-production');
      card.querySelector('.channel-group').textContent = [channel.group, channel.genre,
        limited ? 'iOS limited' : ''].filter(Boolean).join(' · ');
      setChannelLogo(card.querySelector('.channel-logo-wrap'), channel);
      card.addEventListener('click', () => playChannel(channel));
      channelCards.set(channel, card);
      rows.appendChild(card);
    }

    grid.appendChild(rows);
    visibleCount += batch.length;
    moreChannels.hidden = visibleCount >= filteredChannels.length;
    if (moreChannels.hidden) batchObserver?.unobserve(moreChannels);
  }

  const batchObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !moreChannels.hidden) renderBatch();
    }, { rootMargin: '150px' })
    : null;

  categoryFilter.addEventListener('change', filterChannels);
  searchInput.addEventListener('input', filterChannels);
  moreChannels.addEventListener('click', event => {
    const firstNewIndex = visibleCount;
    renderBatch();
    if (event.detail === 0) grid.children[firstNewIndex]?.focus();
  });
  guideAction.addEventListener('click', () => {
    if (searchInput.disabled) {
      fetchChannels();
    } else {
      categoryFilter.value = 'All';
      searchInput.value = '';
      searchInput.focus();
      filterChannels();
    }
  });

  function setPlayerStatus(state, message) {
    if (state !== 'loading') clearTimeout(nativeStartupTimer);
    playerStatus.dataset.state = state;
    playerStatus.textContent = message;
  }

  function updateChannelLink(channel) {
    const url = new URL(location.href);
    if (channel) url.searchParams.set('ch', channel.shareName);
    else url.searchParams.delete('ch');
    history.replaceState(history.state, '', url);
  }

  function stopNativePlayback() {
    clearTimeout(nativeStartupTimer);
    nativeRequest = null;
    videoPlayer.pause();
    if (!shakaInstance && videoPlayer.hasAttribute('src')) {
      videoPlayer.removeAttribute('src');
      videoPlayer.load();
    }
  }

  function showNativeError(channel, request, message = 'Stream unavailable', recoverable = true) {
    if (request !== tuneRequest) return;
    if (recoverable && nativeSession?.request === request && recovery?.failed()) return;
    recovery?.stop();
    nativeSession = null;
    tuneRequest++;
    stopNativePlayback();
    shakaInstance?.unload(false).catch(() => {});
    setPlayerStatus('error', message);
  }

  function stopYouTube() {
    const session = youtubeSession;
    youtubeSession = null;
    clearTimeout(session?.readyTimer);
    session?.player?.destroy();
    youtubeContainer.replaceChildren();
    youtubeContainer.hidden = true;
  }

  function stopRadio() {
    radioRequest = null;
    radioPlayer.pause();
    if (radioPlayer.hasAttribute('src')) {
      radioPlayer.removeAttribute('src');
      radioPlayer.load();
    }
    radioContainer.hidden = true;
  }

  function playRadio(channel, request) {
    radioContainer.hidden = false;
    radioRequest = request;
    radioPlayer.setAttribute('aria-label', `${channel.name} live radio`);
    setChannelLogo(radioLogo, channel, false);
    setPlayerStatus('loading', 'Connecting to radio…');
    nativeStartupTimer = setTimeout(() => {
      if (radioRequest === tuneRequest) setPlayerStatus('error', 'Station unavailable');
    }, 15000);
    radioPlayer.src = channel.url;
    radioPlayer.play().catch(error => {
      if (radioRequest !== request || request !== tuneRequest) return;
      setPlayerStatus(error.name === 'NotAllowedError' ? 'ready' : 'error',
        error.name === 'NotAllowedError' ? 'Press play to listen' : 'Station unavailable');
    });
  }

  radioPlayer.addEventListener('playing', () => {
    if (radioRequest === tuneRequest) setPlayerStatus('live', 'Live radio');
  });
  radioPlayer.addEventListener('canplay', () => {
    if (radioRequest === tuneRequest && radioPlayer.paused) setPlayerStatus('ready', 'Press play to listen');
  });
  radioPlayer.addEventListener('pause', () => {
    if (radioRequest === tuneRequest && playerStatus.dataset.state === 'live') setPlayerStatus('paused', 'Paused radio');
  });
  radioPlayer.addEventListener('error', () => {
    if (radioRequest === tuneRequest) setPlayerStatus('error', 'Station unavailable');
  });

  async function findLiveYouTube(endpoint) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return null;
      const result = await response.json();
      return result?.status === 'live' && typeof result.videoId === 'string' && /^[\w-]{11}$/.test(result.videoId)
        ? result.videoId : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function loadYouTubeApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (!youtubeApiPromise) {
      youtubeApiPromise = new Promise(resolve => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => finish(null), 5000);
        function finish(api) {
          clearTimeout(timeout);
          delete window.onYouTubeIframeAPIReady;
          script.onerror = null;
          if (!api) script.remove();
          resolve(api);
        }
        window.onYouTubeIframeAPIReady = () => finish(window.YT?.Player ? window.YT : null);
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () => finish(null);
        document.head.appendChild(script);
      }).then(api => {
        if (!api) youtubeApiPromise = null;
        return api;
      });
    }
    return youtubeApiPromise;
  }

  function mountYouTube(api, videoId, channel, request) {
    const iframe = document.createElement('iframe');
    iframe.title = `${channel.name} on YouTube Live`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    const url = new URL(`https://www.youtube.com/embed/${videoId}`);
    url.search = new URLSearchParams({ enablejsapi: '1', playsinline: '1', origin: location.origin });
    iframe.src = url.href;

    const session = { player: null, readyTimer: null };
    youtubeSession = session;
    const isCurrent = () => request === tuneRequest && youtubeSession === session;
    const fallback = () => {
      if (isCurrent()) playNativeChannel(channel, request);
    };
    session.readyTimer = setTimeout(fallback, 8000);
    setPlayerStatus('loading', 'Loading YouTube Live…');
    youtubeContainer.replaceChildren(iframe);

    try {
      session.player = new api.Player(iframe, { events: {
        onReady(event) {
          if (!isCurrent()) return;
          clearTimeout(session.readyTimer);
          setPlayerStatus('ready', 'YouTube Live · Press play');
          event.target.playVideo();
        },
        onAutoplayBlocked() {
          if (isCurrent()) setPlayerStatus('ready', 'YouTube Live · Press play');
        },
        onError: fallback,
        onStateChange(event) {
          if (!isCurrent()) return;
          if (event.data === api.PlayerState.PLAYING) setPlayerStatus('live', 'Live on YouTube');
          if (event.data === api.PlayerState.PAUSED) setPlayerStatus('paused', 'Paused · YouTube Live');
          if (event.data === api.PlayerState.ENDED) {
            stopYouTube();
            playPreferredSource(channel, request, videoId);
          }
        }
      } });
    } catch {
      fallback();
    }
  }

  async function playPreferredSource(channel, request, endedVideoId = null) {
    if (channel.youtubeLiveEndpoint) {
      videoContainer.hidden = true;
      youtubeContainer.hidden = false;
      setPlayerStatus('loading', 'Checking YouTube Live…');
      const videoId = await findLiveYouTube(channel.youtubeLiveEndpoint);
      if (request !== tuneRequest) return;

      if (videoId && videoId !== endedVideoId) {
        const api = await loadYouTubeApi();
        if (request !== tuneRequest) return;
        if (api) {
          shakaInstance?.unload(false).catch(() => {});
          mountYouTube(api, videoId, channel, request);
          return;
        }
      }
    }
    return playNativeChannel(channel, request);
  }

  async function playChannel(channel, scroll = true) {
    recovery?.stop();
    nativeSession = null;
    const request = ++tuneRequest;
    stopRadio();
    stopYouTube();
    channelCards.get(activeChannel)?.setAttribute('aria-pressed', 'false');
    activeChannel = channel;
    channelCards.get(channel)?.setAttribute('aria-pressed', 'true');

    playerTitle.textContent = channel.name;
    setChannelLogo(playerLogo, channel, false);
    playerSection.hidden = false;
    workspace.classList.add('is-tuned');
    updateChannelLink(channel);
    if (scroll) {
      playerTitle.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    const url = channel.url;
    const onYouTube = url.startsWith('youtube:');
    const onRadio = channel.type === 'Radio';
    videoContainer.hidden = onYouTube || onRadio;
    setPlayerStatus('loading', 'Connecting to stream…');
    stopNativePlayback();

    if (onRadio) {
      shakaInstance?.unload(false).catch(() => {});
      playRadio(channel, request);
      return;
    }

    if (onYouTube) {
      shakaInstance?.unload(false).catch(() => {});
      setPlayerStatus('external', 'Opens on YouTube');
      const channelId = url.split(':')[1];
      window.open(`https://www.youtube.com/channel/${channelId}/live`, '_blank', 'noopener');
      return;
    }

    return playPreferredSource(channel, request);
  }

  async function playNativeChannel(channel, request, existingSession = null) {
    if (request !== tuneRequest || (existingSession && nativeSession !== existingSession)) return;
    if (!existingSession) {
      nativeSession = { channel, request, playRequested: false };
      recovery?.start(nativeSession);
    }
    nativeSession.playRequested = false;
    stopYouTube();
    videoContainer.hidden = false;
    if (!existingSession) setPlayerStatus('loading', 'Connecting to stream…');
    const url = channel.url;
    const sourceMimeType = window.LiveStreamSource?.manifestMimeType(url);
    try {
      await initShakaUI();
    } catch (error) {
      console.error('Player initialization failed:', error);
      showNativeError(channel, request);
      return;
    }
    if (request !== tuneRequest) return;

    if (shakaInstance) {
      try {
        await shakaInstance.unload(false);
      } catch(e) {}
    }
    if (request !== tuneRequest) return;
    nativeRequest = request;

    const startVideo = () => {
      if (request !== tuneRequest || (recovery && !recovery.wantsPlay())) return;
      nativeSession.playRequested = true;
      videoPlayer.play().catch(error => {
        if (request !== tuneRequest) return;
        if (error.name === 'NotAllowedError') {
          recovery?.intent(false);
          setPlayerStatus('ready', 'Press play to start');
        } else if (!recovery || recovery.wantsPlay()) {
          showNativeError(channel, request);
        }
      });
    };
    videoPlayer.controls = !shakaInstance;

    if (sourceMimeType || url.includes('.mpd') || url.includes('.m3u8') || url.endsWith('.mp4')) {
      if (shakaInstance) {
        // Configure DRM if present
        const shakaConfig = {
          preferredAudioLanguage: 'en',
          preferredTextLanguage: 'en',
          // Shaka 4.7 needs TS transmuxing for the relay's rotating AES-128 HLS.
          // Reset this setting when switching away from a BX-TV HLS source.
          mediaSource: { forceTransmux: sourceMimeType === 'application/x-mpegurl' },
          drm: {
            clearKeys: channel.drm || {},
            servers: {},
            preferredKeySystems: channel.drm ? ['org.w3.clearkey'] : []
          }
        };
        shakaInstance.configure(shakaConfig);

        // Add network filter for proxied streams (Cloudflare or Railway)
        const proxyPatterns = [
          { match: 'blue-voice-4f1f', base: 'https://blue-voice-4f1f.czg3i9ixp6ywxh2mw61dxdwf.workers.dev/', domainEnd: '.dev/' },
          { match: 'prox-production', base: 'https://prox-production-a3e4.up.railway.app/', domainEnd: '.app/' },
          { match: 'floral-bird-e8ca', base: 'https://floral-bird-e8ca.zjhw6oev542aefbid27l4ifo.workers.dev/', domainEnd: '.dev/' },
          { match: 'tiny-sky-b9fd', base: 'https://tiny-sky-b9fd.v32k84wntwbguzg6hf4tkrsq.workers.dev/', domainEnd: '.dev/' }
        ];
        const activeProxy = proxyPatterns.find(p => url.includes(p.match));
        
        shakaInstance.getNetworkingEngine().clearAllRequestFilters();
        shakaInstance.getNetworkingEngine().clearAllResponseFilters();

        shakaInstance.getNetworkingEngine().registerResponseFilter((type, response) => {
          if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT) {
            window.LiveStreamSource?.normalizeSegmentResponse(response);
          }
        });

        if (activeProxy) {
          const proxyUA = 'Dalvik/2.1.0';
          let mpdBaseUrl = '';
          let currentProxyBase = '';
          if (url.includes('?url=')) {
            currentProxyBase = url.substring(0, url.indexOf('?url='));
            const mpdUrlParam = url.match(/\?url=([^&]+)/);
            if (mpdUrlParam) {
              const decoded = decodeURIComponent(mpdUrlParam[1]);
              mpdBaseUrl = decoded.substring(0, decoded.lastIndexOf('/') + 1);
            }
          }

          shakaInstance.getNetworkingEngine().registerRequestFilter((type, request) => {
            if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
              request.headers['Content-Type'] = 'application/octet-stream';
            }
            
            for (let i = 0; i < request.uris.length; i++) {
              let uri = request.uris[i];
              if (uri.startsWith('data:')) continue;
              
              // If we know the active proxy base and the uri starts with it
              if (currentProxyBase && uri.startsWith(currentProxyBase)) {
                if (uri.includes('?url=')) continue; // Already proxied properly
                
                const afterDomain = uri.substring(currentProxyBase.length);
                if (afterDomain) {
                  let fixDomain = afterDomain;
                  if(fixDomain.startsWith('dash/')) fixDomain = fixDomain.substring(5);
                  const realUrl = mpdBaseUrl + fixDomain;
                  request.uris[i] = currentProxyBase + '?url=' + encodeURIComponent(realUrl) + '&ua=' + encodeURIComponent(proxyUA);
                }
                continue;
              }
              
              // If it's an absolute URL that isn't using the proxy yet, proxy it
              if (!uri.includes('?url=')) {
                const baseProxy = currentProxyBase || activeProxy.base;
                request.uris[i] = baseProxy + '?url=' + encodeURIComponent(uri) + '&ua=' + encodeURIComponent(proxyUA);
              }
            }
          });
          
          // Add response filter to fix invalid XML ampersands from proxy
          shakaInstance.getNetworkingEngine().registerResponseFilter((type, response) => {
            if (type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
              let text = shaka.util.StringUtils.fromUTF8(response.data);
              if (text.includes('<?xml')) {
                text = text.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
                response.data = shaka.util.StringUtils.toUTF8(text);
              }
            }
          });
        }

        try {
          const mimeType = sourceMimeType || (channel.youtubeLiveEndpoint && url.includes('.mpd') ? 'application/dash+xml' : undefined);
          await shakaInstance.load(url, null, mimeType);
          if (request === tuneRequest) startVideo();
        } catch (e) {
          if (request !== tuneRequest) return;
          console.error('Error loading stream:', e);
          showNativeError(channel, request);
        }
      } else if (url.endsWith('.mp4') || videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // Fallback for iOS/Safari native HLS playback
        let nativeUrl = url;
        
        // Attempt to seamlessly translate DASH manifest URLs into HLS playlists
        if (nativeUrl.includes('manifest.mpd')) {
          nativeUrl = nativeUrl.replace('manifest.mpd', 'index.m3u8');
          nativeUrl = nativeUrl.replace('JITPMediaType=DASH', 'JITPMediaType=HLS');
        } else if (nativeUrl.includes('.dash')) {
          nativeUrl = nativeUrl.replace('.dash', '.m3u8');
        }

        videoPlayer.src = nativeUrl;
        startVideo();
      } else {
        showNativeError(channel, request, 'This browser can’t play the stream', false);
      }
    } else {
      videoPlayer.src = url;
      startVideo();
    }
  }

  videoPlayer.addEventListener('play', () => {
    if (nativeRequest === tuneRequest) recovery?.intent(true);
  });
  videoPlayer.addEventListener('playing', () => {
    if (nativeRequest === tuneRequest && !videoPlayer.paused) setPlayerStatus('live', 'Live');
  });
  videoPlayer.addEventListener('pause', () => {
    if (nativeRequest === tuneRequest && videoPlayer.paused && !document.hidden && !pageSuspended && !videoPlayer.error && nativeSession?.playRequested) {
      if (playerStatus.dataset.state === 'ready' && recovery && !recovery.wantsPlay()) return;
      recovery?.intent(false);
      setPlayerStatus('paused', 'Paused');
    }
  });
  videoPlayer.addEventListener('seeking', () => {
    if (nativeRequest === tuneRequest) recovery?.grace();
  });
  videoPlayer.addEventListener('waiting', () => {
    if (nativeRequest === tuneRequest && (!recovery || recovery.wantsPlay())) setPlayerStatus('loading', 'Buffering…');
  });
  videoPlayer.addEventListener('error', () => {
    if (nativeRequest === tuneRequest && videoPlayer.error) showNativeError(activeChannel, nativeRequest);
  });

  document.getElementById('closeLiveTvPlayer').addEventListener('click', () => {
    recovery?.stop();
    nativeSession = null;
    tuneRequest++;
    const card = channelCards.get(activeChannel);
    card?.setAttribute('aria-pressed', 'false');
    activeChannel = null;
    stopRadio();
    stopYouTube();
    stopNativePlayback();
    shakaInstance?.unload(false).catch(() => {});
    playerSection.hidden = true;
    workspace.classList.remove('is-tuned');
    updateChannelLink(null);
    (card || searchInput).focus();
  });

  function wakeNativePlayback() {
    if (document.hidden || pageSuspended || navigator.onLine === false) return;
    recovery?.wake();
    if (nativeRequest !== tuneRequest || !recovery?.wantsPlay() || recovery.loading() || !videoPlayer.paused) return;
    const request = nativeRequest;
    videoPlayer.play().catch(error => {
      if (request !== tuneRequest) return;
      if (error.name === 'NotAllowedError') {
        recovery.intent(false);
        setPlayerStatus('ready', 'Press play to start');
      } else showNativeError(activeChannel, request);
    });
  }
  window.addEventListener('offline', () => recovery?.suspend());
  window.addEventListener('online', wakeNativePlayback);
  window.addEventListener('pagehide', () => { pageSuspended = true; recovery?.suspend(); });
  window.addEventListener('pageshow', () => { pageSuspended = false; wakeNativePlayback(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) recovery?.suspend();
    else wakeNativePlayback();
  });

  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (navigator.share) {
        navigator.share({
          title: `Watching ${playerTitle.textContent} on Live TV`,
          url: window.location.href
        }).catch(console.error);
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href)
          .then(() => showToast('Channel link copied.'))
          .catch(() => showToast('Could not copy the channel link.'));
      } else {
        showToast('Sharing is not supported on this browser.');
      }
    });
  }

  fetchChannels();
  };
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLiveTV);
  } else {
    initLiveTV();
  }
})();
