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
          dash: { ignoreMinBufferTime: true },
          hls: { 
            ignoreTextStreamFailures: true,
            ignoreManifestProgramDateTime: true
          }
        },
        streaming: {
          lowLatencyMode: true,
          inaccurateManifestTolerance: 0,
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

  function filterChannels() {
    const selectedCategory = categoryFilter ? categoryFilter.value : 'All';

    const filtered = allChannels.filter(ch => {
      const matchesCategory = selectedCategory === 'All' || ch.group === selectedCategory;
      return matchesCategory;
    });

    renderChannels(filtered);
  }

  if (categoryFilter) categoryFilter.addEventListener('change', filterChannels);

  const categoryOrder = [
    'Kids & Cartoons',
    'Movies',
    'News',
    'Entertainment',
    'Documentary',
    'Sports',
    'Music',
    'General'
  ];

  function renderChannels(channels) {
    grid.innerHTML = '';
    
    // Group channels
    const grouped = {};
    channels.forEach(ch => {
      if (!grouped[ch.group]) grouped[ch.group] = [];
      grouped[ch.group].push(ch);
    });

    // Sort categories based on requested order
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
      let idxA = categoryOrder.indexOf(a);
      let idxB = categoryOrder.indexOf(b);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      if (idxA !== idxB) return idxA - idxB;
      return a.localeCompare(b);
    });

    sortedCategories.forEach((cat, index) => {
      const section = document.createElement('section');
      section.className = 'media-section row';
      section.style.paddingTop = '10px';
      section.style.paddingBottom = '10px';
      
      const header = document.createElement('div');
      header.className = 'section-header';
      header.innerHTML = `<h2 class="section-title">${cat}</h2>`;
      section.appendChild(header);

      const railId = `livetv-rail-${index}`;
      const sliderContainer = document.createElement('div');
      sliderContainer.className = 'rail-container';
      sliderContainer.innerHTML = `
        <button class="row-arrow rail-arrow-left" data-target="${railId}" disabled aria-label="Scroll left">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <button class="row-arrow rail-arrow-right" data-target="${railId}" aria-label="Scroll right">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      `;

      const slider = document.createElement('div');
      slider.className = 'media-slider card-rail';
      slider.id = railId;
      // Inline styles to ensure horizontal scrolling inside the container
      slider.style.display = 'flex';
      slider.style.gap = '16px';
      slider.style.overflowX = 'auto';
      slider.style.scrollSnapType = 'x mandatory';
      slider.style.scrollbarWidth = 'none';
      // Sort channels within the category alphabetically
      grouped[cat].sort((a, b) => a.name.localeCompare(b.name)).forEach(ch => {
        const card = document.createElement('div');
        card.className = 'card card-landscape channel-card';
        card.style.flex = '0 0 auto';
        card.style.width = '240px';
        card.style.scrollSnapAlign = 'start';
        
        const encodedName = encodeURIComponent(ch.name);
        const fallbackLogo = `https://ui-avatars.com/api/?name=${encodedName}&background=random&color=fff&size=256&font-size=0.33&bold=true`;
        const logoUrl = ch.logo || fallbackLogo;
        
        card.innerHTML = `
          <div class="card-img-wrap" style="aspect-ratio: 16/9; background: #BDBDBD;">
            <img class="card-image" src="${logoUrl}" alt="${ch.name}" loading="lazy" style="object-fit: contain; padding: 16px; background: #BDBDBD;" onerror="if(this.src!=='${fallbackLogo}')this.src='${fallbackLogo}';">
            <div class="card-overlay" style="justify-content: center; align-items: center; background: rgba(0,0,0,0.3);">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="white"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
          </div>
          <div class="card-info" style="padding: 12px; text-align: center;">
            <span class="card-info-title" style="font-size: 0.95rem; font-weight: 700; color: var(--text-bright);">${ch.name}</span>
          </div>
        `;
        
        card.addEventListener('click', () => {
          playChannel(ch);
        });
        
        slider.appendChild(card);
      });

      sliderContainer.appendChild(slider);
      section.appendChild(sliderContainer);
      grid.appendChild(section);

      const leftBtn = sliderContainer.querySelector('.rail-arrow-left');
      const rightBtn = sliderContainer.querySelector('.rail-arrow-right');
      
      leftBtn.addEventListener('click', () => scrollRail(slider, true, leftBtn, rightBtn));
      rightBtn.addEventListener('click', () => scrollRail(slider, false, leftBtn, rightBtn));
      
      slider.addEventListener('scroll', () => updateArrows(slider, leftBtn, rightBtn), { passive: true });
      setTimeout(() => updateArrows(slider, leftBtn, rightBtn), 100);
    });
  }

  function scrollRail(rail, isLeft, leftBtn, rightBtn) {
    const amount = rail.clientWidth * 0.8;
    rail.scrollBy({ left: isLeft ? -amount : amount, behavior: "smooth" });
    setTimeout(() => updateArrows(rail, leftBtn, rightBtn), 300);
  }

  function updateArrows(rail, leftBtn, rightBtn) {
    const maxScroll = rail.scrollWidth - rail.clientWidth;
    if (leftBtn) leftBtn.disabled = rail.scrollLeft <= 4;
    if (rightBtn) rightBtn.disabled = rail.scrollLeft >= maxScroll - 4;
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
          const proxyUA = 'Dalvik/2.1.0 (Linux; U; Android 12; Pixel 6 Build/SD1A.210817.036)';
          let mpdBaseUrl = '';
          const mpdUrlParam = url.match(/\?url=([^&]+)/);
          if (mpdUrlParam) {
            const decoded = decodeURIComponent(mpdUrlParam[1]);
            mpdBaseUrl = decoded.substring(0, decoded.lastIndexOf('/') + 1);
          }

          shakaInstance.getNetworkingEngine().registerRequestFilter((type, request) => {
            if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
              request.headers['Content-Type'] = 'application/octet-stream';
            }
            
            for (let i = 0; i < request.uris.length; i++) {
              let uri = request.uris[i];
              if (uri.startsWith('data:')) continue;
              if (uri.includes(activeProxy.match) && uri.includes('?url=') && uri.includes('&ua=')) continue;
              if (uri.includes(activeProxy.match)) {
                const domainIdx = uri.indexOf(activeProxy.domainEnd);
                if (domainIdx > -1) {
                  const afterDomain = uri.substring(domainIdx + activeProxy.domainEnd.length);
                  if (afterDomain && !afterDomain.startsWith('?')) {
                    let fixDomain = afterDomain;
                    if(fixDomain.startsWith('dash/')) fixDomain = fixDomain.substring(5);
                    const realUrl = mpdBaseUrl + fixDomain;
                    request.uris[i] = activeProxy.base + '?url=' + encodeURIComponent(realUrl) + '&ua=' + encodeURIComponent(proxyUA);
                  }
                }
                continue;
              }
              request.uris[i] = activeProxy.base + '?url=' + encodeURIComponent(uri) + '&ua=' + encodeURIComponent(proxyUA);
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
