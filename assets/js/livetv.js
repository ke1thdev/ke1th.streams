(() => {
  const catalogRevision = document.currentScript?.src ? new URL(document.currentScript.src).search : '';
  const initLiveTV = () => {
  const grid = document.getElementById('livetvGrid');
  const videoPlayer = document.getElementById('liveVideoPlayer');
  const videoContainer = document.getElementById('videoContainer');
  const youtubeContainer = document.getElementById('liveYouTubeContainer');
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
            lowLatencyMode: true,
            inaccurateManifestTolerance: 5,
            rebufferingGoal: 2,
            bufferingGoal: 10,
          }
        };
        shakaInstance.configure(playerConfig);

        shakaInstance.addEventListener('error', event => {
          console.error('Shaka Error:', event.detail);
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

      const phtHour = (new Date().getUTCHours() + 8) % 24;
      allChannels = data.map(ch => {
        const isUSNetwork = ch.name === 'Cartoon Network / Adult Swim (US)';
        const isAdultSwim = phtHour >= 6 && phtHour < 19;
        return {
          name: isUSNetwork ? (isAdultSwim ? 'Adult Swim' : 'Cartoon Network (US)') : ch.name,
          shareName: ch.name,
          group: ch.category || ch.group || 'General',
          logo: isUSNetwork && !isAdultSwim
            ? 'https://upload.wikimedia.org/wikipedia/commons/8/80/Cartoon_Network_2010_logo.svg'
            : ch.logo,
          url: ch.streamUrl || ch.url,
          drm: ch.drm,
          youtubeLiveEndpoint: ch.youtubeLiveEndpoint
        };
      }).filter(channel => typeof channel.url === 'string' && channel.url.trim());

      allChannels.sort((a, b) => Number(isPhChannel(b.name)) - Number(isPhChannel(a.name)) || a.name.localeCompare(b.name));
      const categories = Array.from(new Set(allChannels.map(channel => channel.group))).sort();
      for (const category of categories) categoryFilter.add(new Option(category, category));
      categoryFilter.disabled = false;
      searchInput.disabled = false;
      filterChannels();

      const sharedName = new URLSearchParams(location.search).get('ch')?.toLowerCase();
      if (!sharedName) return;
      const previousNames = {
        'cartoon network': 'cartoon network asia',
        'adult swim': 'cartoon network / adult swim (us)'
      };
      const targetName = Object.hasOwn(previousNames, sharedName) ? previousNames[sharedName] : sharedName;
      const channel = allChannels.find(item =>
        item.shareName.toLowerCase() === targetName || item.name.toLowerCase() === targetName);
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
      const words = channel.name.match(/[\p{L}\p{N}]+/gu) || [];
      label.textContent = (words.length > 1
        ? words.slice(0, 3).map(word => word[0]).join('')
        : (words[0] || 'TV').slice(0, 3)).toUpperCase();
      well.replaceChildren(label);
    };

    // This retired image returns an Imgur placeholder with a successful HTTP status.
    if (!channel.logo || channel.logo === 'https://i.imgur.com/b9UaL8G.png') {
      fallback();
      return;
    }

    const logo = document.createElement('img');
    logo.className = 'channel-logo';
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
      && channel.name.toLowerCase().includes(query));
    const count = filteredChannels.length;
    channelCount.textContent = count + (count === 1 ? ' channel' : ' channels');
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
      card.querySelector('.channel-group').textContent = channel.group + (limited ? ' · iOS limited' : '');
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

  function showNativeError(channel, request, message = 'Stream unavailable') {
    if (request !== tuneRequest) return;
    setPlayerStatus('error', message);
    if (!channel.youtubeLiveEndpoint) return;

    tuneRequest++;
    videoContainer.hidden = true;
    stopNativePlayback();
    shakaInstance?.unload(false).catch(() => {});
  }

  function stopYouTube() {
    const session = youtubeSession;
    youtubeSession = null;
    clearTimeout(session?.readyTimer);
    session?.player?.destroy();
    youtubeContainer.replaceChildren();
    youtubeContainer.hidden = true;
  }

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
    const request = ++tuneRequest;
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
    videoContainer.hidden = onYouTube;
    setPlayerStatus('loading', 'Connecting to stream…');
    stopNativePlayback();

    if (onYouTube) {
      shakaInstance?.unload(false).catch(() => {});
      setPlayerStatus('external', 'Opens on YouTube');
      const channelId = url.split(':')[1];
      window.open(`https://www.youtube.com/channel/${channelId}/live`, '_blank', 'noopener');
      return;
    }

    return playPreferredSource(channel, request);
  }

  async function playNativeChannel(channel, request) {
    stopYouTube();
    videoContainer.hidden = false;
    setPlayerStatus('loading', 'Connecting to stream…');
    if (channel.youtubeLiveEndpoint) {
      nativeStartupTimer = setTimeout(() => showNativeError(channel, request), 9000);
    }
    const url = channel.url;
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
      videoPlayer.play().catch(error => {
        if (request !== tuneRequest || playerStatus.dataset.state !== 'loading') return;
        if (!channel.youtubeLiveEndpoint || error.name === 'NotAllowedError') {
          setPlayerStatus('ready', 'Press play to start');
        } else {
          showNativeError(channel, request);
        }
      });
    };
    videoPlayer.controls = !shakaInstance;

    if (url.includes('.mpd') || url.includes('.m3u8') || url.endsWith('.mp4')) {
      if (shakaInstance) {
        // Configure DRM if present
        const shakaConfig = {
          preferredAudioLanguage: 'en',
          preferredTextLanguage: 'en',
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
          const mimeType = channel.youtubeLiveEndpoint && url.includes('.mpd') ? 'application/dash+xml' : undefined;
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
        showNativeError(channel, request, 'This browser can’t play the stream');
      }
    } else {
      videoPlayer.src = url;
      startVideo();
    }
  }

  videoPlayer.addEventListener('playing', () => {
    if (nativeRequest === tuneRequest) setPlayerStatus('live', 'Live');
  });
  videoPlayer.addEventListener('pause', () => {
    if (nativeRequest === tuneRequest && playerStatus.dataset.state === 'live') setPlayerStatus('paused', 'Paused');
  });
  videoPlayer.addEventListener('error', () => {
    if (nativeRequest === tuneRequest) showNativeError(activeChannel, nativeRequest);
  });

  document.getElementById('closeLiveTvPlayer').addEventListener('click', () => {
    tuneRequest++;
    const card = channelCards.get(activeChannel);
    card?.setAttribute('aria-pressed', 'false');
    activeChannel = null;
    stopYouTube();
    stopNativePlayback();
    shakaInstance?.unload(false).catch(() => {});
    playerSection.hidden = true;
    workspace.classList.remove('is-tuned');
    updateChannelLink(null);
    (card || searchInput).focus();
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
