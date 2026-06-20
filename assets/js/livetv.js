(() => {
  const initLiveTV = () => {
  const M3U_URL = 'https://iptv-org.github.io/iptv/countries/ph.m3u';
  const grid = document.getElementById('livetvGrid');
  const videoPlayer = document.getElementById('liveVideoPlayer');
  const iframePlayer = document.getElementById('liveIframePlayer');
  const playerTitle = document.getElementById('inlinePlayerTitle');
  const playerLogo = document.getElementById('inlinePlayerLogo');
  
  let hlsInstance = null;
  let dashInstance = null;
  let shakaInstance = null;
  let allChannels = [];


  // Toast Notification System
  function showToast(message) {
    const existing = document.getElementById('playerToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'playerToast';
    toast.textContent = message;
    toast.style.cssText = 'position: absolute; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(229, 9, 20, 0.9); color: white; padding: 10px 20px; border-radius: 8px; z-index: 10000; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: none;';
    
    // Append to video container
    const container = document.querySelector('.video-container');
    if (container) {
      container.appendChild(toast);
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
    }
  }

  function hexToBase64Url(hexStr) {
    if (!hexStr) return '';
    let hexArray = hexStr.match(/[0-9a-fA-F]{2}/g).map(byte => parseInt(byte, 16));
    let base64 = btoa(String.fromCharCode.apply(null, hexArray));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

    // Initialize Shaka UI once
  let ui = null;
  function initShakaUI() {
    if (!shakaInstance && typeof shaka !== 'undefined') {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        showToast('Your browser does not support this stream.');
        return;
      }

      // If Shaka UI auto-setup ran on the video element, grab its player instance
      if (videoPlayer['ui']) {
        ui = videoPlayer['ui'];
        shakaInstance = ui.getControls().getPlayer();
      } else {
        // Fallback manual setup
        shakaInstance = new shaka.Player();
        shakaInstance.attach(videoPlayer);
        const videoContainer = document.getElementById('videoContainer');
        ui = new shaka.ui.Overlay(shakaInstance, videoContainer, videoPlayer);
      }
      
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

      shakaInstance.addEventListener('error', (event) => {
        console.error('Shaka Error:', event.detail);
      });
    }
  }

  async function fetchChannels() {
    try {
      const response = await fetch('/channels/channels.json');
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      
      allChannels = data.map(ch => {
        let name = ch.name;
        let logo = ch.logo;

        // Dynamic Cartoon Network / Adult Swim check (US servers vs PHT)
        if (name === "Cartoon Network / Adult Swim (US)") {
          const phtHour = (new Date().getUTCHours() + 8) % 24;
          // Adult Swim is 6:00 AM to 7:00 PM PHT
          if (phtHour >= 6 && phtHour < 19) {
            name = "Adult Swim";
            logo = "https://en.wikipedia.org/wiki/Special:FilePath/Adult_Swim_2003_logo.svg";
          } else {
            // Cartoon Network is 7:00 PM to 6:00 AM PHT
            name = "Cartoon Network";
            logo = "https://en.wikipedia.org/wiki/Special:FilePath/Cartoon_Network_2010_logo.svg";
          }
        }

        return {
          name: name,
          group: ch.category || 'General',
          logo: logo,
          url: ch.streamUrl,
          drm: ch.drm
        };
      });
      
      populateCategories(allChannels);
      renderChannels(allChannels);
      
      // Auto-play channel from URL if present
      const urlParams = new URLSearchParams(window.location.search);
      const targetChannelName = urlParams.get('ch');
      if (targetChannelName) {
        const targetChannel = allChannels.find(c => c.name.toLowerCase() === targetChannelName.toLowerCase());
        if (targetChannel) {
          playChannel(targetChannel, true);
        }
      }
    } catch (err) {
      console.error('Error fetching channels:', err);
      grid.innerHTML = '<p style="color: var(--text); padding: 20px;">Failed to load channels. Please try again later.</p>';
    }
  }

  function populateCategories(channels) {
    const filter = document.getElementById('categoryFilter');
    if (!filter) return;
    const categories = [];
    const seen = new Set();
    channels.forEach(ch => { if (!seen.has(ch.group)) { seen.add(ch.group); categories.push(ch.group); } });
    const sortedCategories = categories;
    sortedCategories.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      filter.appendChild(option);
    });
  }

  const categoryFilter = document.getElementById('categoryFilter');

  const PH_CHANNELS = [
    'A2Z', 'GMA 7', 'GMA Life TV', 'GMA Pinoy TV', 'Kapamilya Channel', 
    'TV5', 'IBC 13', 'PTV', 'TVN Movies (Tagalog)', 'Solar', 'PIE', 'One PH', 'GTV', 'Cinemax', 'HBO'
  ];

  let filteredChannelsList = [];
  let visibleCount = 0;
  const BATCH_SIZE = 30;

  function isPhChannel(name) {
    const lowerName = name.toLowerCase();
    return PH_CHANNELS.some(ph => lowerName.includes(ph.toLowerCase()) || ph.toLowerCase().includes(lowerName));
  }

  function sortChannels(channels) {
    return channels.sort((a, b) => {
      const isAPh = isPhChannel(a.name);
      const isBPh = isPhChannel(b.name);
      if (isAPh && !isBPh) return -1;
      if (!isAPh && isBPh) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  function filterChannels() {
    const categoryFilter = document.getElementById('categoryFilter');
    const searchInput = document.getElementById('liveTvSearchInput');
    const selectedCategory = categoryFilter ? categoryFilter.value : 'All';
    const query = searchInput ? searchInput.value.toLowerCase() : '';

    const filtered = allChannels.filter(ch => {
      const matchesCategory = selectedCategory === 'All' || ch.group === selectedCategory;
      const matchesSearch = ch.name.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });

    filteredChannelsList = sortChannels(filtered);
    visibleCount = 0;
    grid.innerHTML = '';
    renderBatch();
  }

  if (categoryFilter) categoryFilter.addEventListener('change', filterChannels);
  
  const searchInput = document.getElementById('liveTvSearchInput');
  if (searchInput) searchInput.addEventListener('input', filterChannels);

  function renderBatch() {
    const nextBatch = filteredChannelsList.slice(visibleCount, visibleCount + BATCH_SIZE);
    if (nextBatch.length === 0) return;

    nextBatch.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'channel-card';
      
      const encodedName = encodeURIComponent(ch.name);
      const fallbackLogo = `https://ui-avatars.com/api/?name=${encodedName}&background=random&color=fff&size=256&font-size=0.33&bold=true`;
      const logoUrl = ch.logo || fallbackLogo;
      
      const url = ch.url || ch.streamUrl;
      const isIosBlocked = ch.drm || (url && url.includes('prox-production'));
      
      let iosIndicator = '';
      if (isIosBlocked) {
        iosIndicator = `
          <span title="Not supported on iOS" style="display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; vertical-align: middle; color: var(--text-muted); position: relative;">
            <svg viewBox="0 0 384 512" width="12" height="12" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.3 48.6-.7 90.4-82.5 102.7-119.3-65.2-30.7-61.7-90-62-91.3zM85.3 18.2c24.2-29.2 55.9-49.1 82.2-46.7-.4 31.5-12.8 61.2-35.1 85.5-22.3 24.3-54.8 43.1-84.7 39.7 1.8-31 13.4-58.8 37.6-78.5z"/></svg>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#e50914" stroke-width="3" style="position: absolute;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </span>
        `;
      }

      card.innerHTML = `
        <div class="channel-logo-wrap" style="background: #BDBDBD;">
          <img class="channel-logo" src="${logoUrl}" alt="${ch.name}" loading="lazy" onerror="if(this.src!=='${fallbackLogo}')this.src='${fallbackLogo}';">
        </div>
        <div class="channel-info">
          <div class="channel-name" style="display: flex; align-items: center; justify-content: center;">${ch.name}${iosIndicator}</div>
          <div class="channel-group">${ch.group}</div>
        </div>
      `;
      
      card.addEventListener('click', () => {
        playChannel(ch);
      });
      
      grid.appendChild(card);
    });

    visibleCount += nextBatch.length;
  }

  function renderChannels(channels) {
    // This function is kept for compatibility with the initial load sequence
    filteredChannelsList = sortChannels(channels);
    visibleCount = 0;
    grid.innerHTML = '';
    renderBatch();
    
    // Setup intersection observer for infinite scroll
    const sentinel = document.getElementById('scrollSentinel');
    if (sentinel) {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          renderBatch();
        }
      }, { rootMargin: '200px' });
      observer.observe(sentinel);
    }
  }

  async function playChannel(channel, scroll = true) {
    if (!channel) return;
    
    playerTitle.textContent = channel.name;
    document.querySelector('.livetv-player-section').style.display = 'block';
    
    if (channel.logo) {
      playerLogo.src = channel.logo;
      playerLogo.style.display = 'block';
    } else {
      playerLogo.style.display = 'none';
    }
    
    if (scroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('ch', channel.name);
    window.history.replaceState({}, '', newUrl);

    videoPlayer.src = '';
    iframePlayer.src = '';
    videoPlayer.classList.add('hidden');
    iframePlayer.classList.add('hidden');

    const url = channel.url || channel.streamUrl;
    
    if (url.startsWith('youtube:')) {
      const channelId = url.split(':')[1];
      window.open(`https://www.youtube.com/channel/${channelId}/live`, '_blank');
      return;
    }

    if (!shakaInstance) initShakaUI();

    if (shakaInstance) {
      try {
        await shakaInstance.unload();
      } catch(e) {}
    }

    if (url.includes('.mpd') || url.includes('.m3u8') || url.endsWith('.mp4')) {
      videoPlayer.classList.remove('hidden');

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
          await shakaInstance.load(url);
          videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
        } catch (e) {
          console.error('Error loading stream:', e);
          showToast('Failed to load this live stream.');
        }
      } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
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
        videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
      }
    } else {
      videoPlayer.classList.remove('hidden');
      videoPlayer.src = url;
      videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
    }
  }

  const shareBtn = document.getElementById('shareBtn');
  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (navigator.share) {
        navigator.share({
          title: `Watching ${playerTitle.textContent} on Live TV`,
          url: window.location.href
        }).catch(console.error);
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
