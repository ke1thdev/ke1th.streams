document.addEventListener('DOMContentLoaded', () => {
  const M3U_URL = 'https://iptv-org.github.io/iptv/countries/ph.m3u';
  const grid = document.getElementById('livetvGrid');
  const modal = document.getElementById('playerModal');
  const closeBtn = document.getElementById('closePlayerModal');
  const closeBg = document.getElementById('closePlayerModalBg');
  const videoPlayer = document.getElementById('liveVideoPlayer');
  const iframePlayer = document.getElementById('liveIframePlayer');
  const playerTitle = document.getElementById('playerTitle');
  
  let hlsInstance = null;
  let dashInstance = null;
  let allChannels = [];
  let plyrInstance = null;

  // Initialize landscape orientation module for native <video> elements
  if (window.LandscapeForcer) {
    LandscapeForcer.init();
  }

  // Initialize Plyr Custom Video Player
  if (typeof Plyr !== 'undefined') {
    plyrInstance = new Plyr('#liveVideoPlayer', {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
      autoplay: true,
      settings: ['quality']
    });
  }

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
    } catch (err) {
      console.error('Error fetching channels:', err);
      grid.innerHTML = '<p style="color: var(--text); padding: 20px;">Failed to load channels. Please try again later.</p>';
    }
  }

  function populateCategories(channels) {
    const filter = document.getElementById('categoryFilter');
    if (!filter) return;
    const categories = new Set();
    channels.forEach(ch => categories.add(ch.group));
    const sortedCategories = Array.from(categories).sort();
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
    'Movies & Cinema',
    'Entertainment & Drama',
    'News & Information',
    'Sports',
    'Music',
    'Lifestyle & Docs',
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
          <div class="card-img-wrap" style="aspect-ratio: 16/9; background: #F5F5F5;">
            <img class="card-image" src="${logoUrl}" alt="${ch.name}" loading="lazy" style="object-fit: contain; padding: 16px; background: #F5F5F5;" onerror="if(this.src!=='${fallbackLogo}')this.src='${fallbackLogo}';">
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

  function playChannel(channel) {
    playerTitle.textContent = channel.name;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    // cleanup previous instances
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    if (dashInstance) {
      dashInstance.destroy();
      dashInstance = null;
    }
    videoPlayer.src = '';
    iframePlayer.src = '';
    videoPlayer.classList.add('hidden');
    iframePlayer.classList.add('hidden');

    const url = channel.url;
    
    if (url.startsWith('youtube:')) {
      const channelId = url.split(':')[1];
      window.open(`https://www.youtube.com/channel/${channelId}/live`, '_blank');
      modal.classList.add('hidden');
      return;
    }

    // Force landscape orientation when opening the player
    const videoContainer = document.querySelector('.video-container');
    if (videoContainer && window.LandscapeForcer) {
      videoContainer.classList.add('video-wrapper');
      LandscapeForcer.forceLandscape(videoContainer);
    } else if (url.includes('.mpd')) {
      videoPlayer.classList.remove('hidden');
      // Dash
      if (typeof dashjs !== 'undefined') {
        dashInstance = dashjs.MediaPlayer().create();
        
        // Dynamically apply ClearKey DRM from JSON if present
        if (channel.drm) {
          const clearKeysMap = {};
          for (const [kidHex, keyHex] of Object.entries(channel.drm)) {
            clearKeysMap[hexToBase64Url(kidHex)] = hexToBase64Url(keyHex);
          }
          dashInstance.setProtectionData({
            "org.w3.clearkey": {
              "clearkeys": clearKeysMap
            }
          });
        }
        
        dashInstance.on(dashjs.MediaPlayer.events.ERROR, (e) => {
          console.error("DASH Error:", e);
          if (e.error === 'download' || e.error === 'manifestError' || e.error === 'mediasource') {
            showToast('Stream is currently offline or blocked by the provider.');
          }
        });

        dashInstance.initialize(videoPlayer, url, true);
      } else {
        console.error('DASH Player not loaded.');
      }
    } else if (url.includes('.m3u8')) {
      videoPlayer.classList.remove('hidden');
      // HLS
      if (Hls.isSupported()) {
        hlsInstance = new Hls();
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoPlayer);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
        });
        hlsInstance.on(Hls.Events.ERROR, function (event, data) {
          if (data.fatal) {
            console.error("HLS Error:", data);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                showToast('Stream is offline or connection was refused.');
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hlsInstance.recoverMediaError();
                break;
              default:
                showToast('Failed to load this live stream.');
                hlsInstance.destroy();
                break;
            }
          }
        });
      } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari)
        videoPlayer.src = url;
        videoPlayer.addEventListener('loadedmetadata', () => {
          videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
        });
      } else {
        console.error('HLS is not supported in this browser.');
      }
    } else {
      videoPlayer.classList.remove('hidden');
      // Fallback native
      videoPlayer.src = url;
      videoPlayer.play().catch(e => console.log('Autoplay blocked', e));
    }
  }

  function closePlayer() {
    if (document.activeElement) {
      document.activeElement.blur(); // Fix aria-hidden console warning
    }

    // Release landscape orientation before closing
    const videoContainer = document.querySelector('.video-container.video-wrapper');
    if (videoContainer && window.LandscapeForcer) {
      LandscapeForcer.releaseLandscape(videoContainer);
    }

    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (hlsInstance) hlsInstance.destroy();
    if (dashInstance) dashInstance.destroy();
    videoPlayer.pause();
    videoPlayer.removeAttribute('src');
    videoPlayer.load();
    iframePlayer.src = '';
    iframePlayer.classList.add('hidden');
    videoPlayer.classList.remove('hidden');
  }

  closeBtn.addEventListener('click', closePlayer);
  closeBg.addEventListener('click', closePlayer);

  fetchChannels();
});
