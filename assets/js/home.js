(() => {
  "use strict";

  const config = window.TMDB_CONFIG || {};
  const TMDB_IMG = config.IMAGE_BASE || "https://image.tmdb.org/t/p/w500";
  const TMDB_BACKDROP = config.BACKDROP_BASE || "https://image.tmdb.org/t/p/original";
  const FALLBACK_POSTER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1a1a1a"/><text x="50%" y="50%" fill="#555" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14">No Image</text></svg>`
  )}`;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
  };

  const els = {
    topbar: $("#topbar"),
    hero: $("#hero"),
    heroTag: $("#heroTag"),
    heroTitle: $("#heroTitle"),
    heroMeta: $("#heroMeta"),
    heroOverview: $("#heroOverview"),
    heroPlayBtn: $("#heroPlayBtn"),
    heroDetailsBtn: $("#heroDetailsBtn"),
    rows: $("#rows"),
    searchOverlay: $("#searchOverlay"),
    searchInput: $("#searchInput"),
    searchResults: $("#searchResults"),
    searchCloseBtn: $("#searchCloseBtn"),
    openSearchBtn: $("#openSearchBtn"),
    playerModal: $("#playerModal"),
    trailerFrame: $("#trailerFrame"),
    toast: $("#toast")
  };

  const state = {
    featured: null,
    featuredType: null,
    heroItems: [],
    heroIdx: 0,
    heroTimer: null,
    searchOpen: false,
    searchDebounce: null,
    rowsData: [],
    activeGenres: {},
    activeServer: "videasy",
    playerIdleTimer: null,
    currentPlayback: null,
    currentCategory: 'all'
  };

  // Genre configuration
  const GENRE_CONFIG = {
    preferredIds: [35, 878, 53, 16, 80, 14, 9648, 99, 10751, 36],
    defaultGenreId: 35,
    defaultGenreTitle: 'Comedy'
  };

  const PROVIDER_CONFIG = {
    options: [
      { id: 8, name: "Netflix", logo_path: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
      { id: 9, name: "Prime Video", logo_path: "/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
      { id: 1899, name: "Max", logo_path: "/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
      { id: 337, name: "Disney+", logo_path: "/97yvRBw1GzX7fXprcF80er19ot.jpg" },
      { id: 350, name: "Apple TV+", logo_path: "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
      { id: 531, name: "Paramount+", logo_path: "/h5DcR0J2EESLitnhR8xLG1QymTE.jpg" },
      { id: 15, name: "Hulu", logo_path: "/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg" },
      { id: 283, name: "Crunchyroll", logo_path: "/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" },
      { id: 158, name: "Viu", logo_path: "/o7WsYI2r1llIf9h6JTGVX9yTHPx.jpg" },
      { id: 511, name: "iWantTFC", logo_path: "/jb38w281Douk6kXy1iVB2L7FJTN.jpg" },
      { id: 160, name: "iflix", logo_path: "/vCTY2WtY1oJ8EKpp0UCz4SRpE4S.jpg" }
    ],
    defaultId: 8,
    defaultTitle: "Only on Netflix"
  };

  function getHomeRows(category = 'all') {
    const isAll = category === 'all';
    
    // Handle anime category specially
    if (category === 'anime') {
      return [
        { key: 'trending_anime', title: 'Trending Anime', fetchFn: () => TMDB.discoverAnime(1), fallbackType: '', limit: 14, allowMixed: true, tileStyle: 'landscape', isAnime: true },
        { key: 'top_anime_tv', title: 'Top Anime Series', fetchFn: () => TMDB.discoverTV(16), fallbackType: 'tv', limit: 14, allowMixed: true, tileStyle: 'poster', isAnime: true },
        { key: 'top_anime_movies', title: 'Top Anime Movies', fetchFn: () => TMDB.discoverMovies(16), fallbackType: 'movie', limit: 14, allowMixed: true, tileStyle: 'landscape', isAnime: true }
      ];
    }
    
    const catFallback = isAll ? '' : category;
    const providerFallbackType = category === 'tv' ? 'tv' : 'movie';
    const genreFallbackType = category === 'tv' ? 'tv' : 'movie';

    return [
      { key: 'trending_today', title: 'Trending Now', fetchFn: () => TMDB.getTrending(isAll ? 'all' : category, 'week'), fallbackType: catFallback, limit: 14, allowMixed: isAll, tileStyle: 'landscape' },
      { key: 'top10', title: 'Top 10 Today', fetchFn: () => TMDB.getTrending(isAll ? 'all' : category, 'day'), fallbackType: catFallback, limit: 10, allowMixed: isAll, tileStyle: 'poster' },
      { key: 'provider_dropdown', title: PROVIDER_CONFIG.defaultTitle, dropdownType: 'provider', fetchFn: () => TMDB.discoverByProvider(providerFallbackType, PROVIDER_CONFIG.defaultId), fallbackType: providerFallbackType, limit: 14, allowMixed: false, tileStyle: 'poster' },
      { key: 'top_rated', title: 'Top Rated', fetchFn: () => category === 'tv' ? TMDB.getTopRatedTV() : TMDB.getTopRatedMovies(), fallbackType: catFallback, limit: 14, allowMixed: false, tileStyle: 'landscape' },
      { key: 'genre_dropdown', title: GENRE_CONFIG.defaultGenreTitle, dropdownType: 'genre', fetchFn: () => category === 'tv' ? TMDB.discoverTV(GENRE_CONFIG.defaultGenreId) : TMDB.discoverMovies(GENRE_CONFIG.defaultGenreId), fallbackType: genreFallbackType, limit: 14, allowMixed: false, tileStyle: 'landscape' }
    ];
  }

  init();

  async function init() {
    bindEvents();

    try {
      const rows = await fetchAllRows();
      state.rowsData = rows;
      renderRows(rows);

      const heroRow = rows.find(r => 
        r.items?.length > 0 && 
        r.key !== 'watch_later' && 
        r.key !== 'continue_watching'
      ) || rows.find(r => r.items?.length > 0);

      if (heroRow) {
        state.heroItems = heroRow.items.slice(0, 10);
        setFeatured(state.heroItems[0]);
        startHeroRotation();
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to load content.");
      els.heroTitle.textContent = "Error loading content";
      els.heroOverview.textContent = "Please check your connection and try again.";
    }
  }

  async function fetchAllRows() {
    const rows = [];

    // Fetch genre options for genre dropdown
    let genreOptions = [];
    try {
      const genreData = await TMDB.getMovieGenres();
      genreOptions = normalizeGenreOptions(genreData.genres || []);
    } catch (err) {
      console.error('Failed to fetch genres:', err);
    }

    // Fetch rows sequentially to avoid overwhelming the API
    const results = [];
    
    // Inject Continue Watching row if present
    if (state.currentCategory === 'all') {
      try {
        const progressData = JSON.parse(localStorage.getItem('watchProgress') || '{}');
        const sortedProgress = Object.entries(progressData)
          .filter(([key, data]) => data.lastUpdated && data.progress < 95)
          .sort((a, b) => b[1].lastUpdated - a[1].lastUpdated)
          .slice(0, 12);

        if (sortedProgress.length > 0) {
          const continueItems = [];
          for (const [key, data] of sortedProgress) {
             const parts = key.split('_');
             const pType = parts[0];
             const pId = parts[1];
             const season = parts[2];
             const episode = parts[3];
             
             try {
                let tmdbData;
                if (pType === 'tv') {
                   tmdbData = await TMDB.getTVDetails(pId);
                } else if (pType === 'movie') {
                   tmdbData = await TMDB.getMovieDetails(pId);
                }
                
                if (tmdbData) {
                   tmdbData.mediaType = pType;
                   tmdbData.progressData = data;
                   tmdbData.season = season;
                   tmdbData.episode = episode;
                   continueItems.push(tmdbData);
                }
             } catch(err) {}
          }
          
          if (continueItems.length > 0) {
             results.push({
               key: 'continue_watching',
               title: 'Continue Watching',
               tileStyle: 'landscape',
               items: continueItems,
               dropdownType: null
             });
          }
        }
      } catch(e) {}

      // Inject Watch Later row if present
      try {
        const watchLaterItems = JSON.parse(localStorage.getItem('watchLater')) || [];
        if (watchLaterItems.length > 0) {
          results.push({
            key: 'watch_later',
            title: 'Watch Later',
            tileStyle: 'landscape',
            items: watchLaterItems.slice(0, 14),
            dropdownType: null
          });
        }
      } catch(e) {}
    }

    const currentRows = getHomeRows(state.currentCategory);
    for (const rowConfig of currentRows) {
      try {
        const data = await rowConfig.fetchFn();
        const items = pickMediaItems(data.results || [], rowConfig.fallbackType, rowConfig.limit, rowConfig.allowMixed);

        // Add rank for top10
        if (rowConfig.key === 'top10') {
          items.forEach((item, index) => {
            item.rank = index + 1;
          });
        }

        // Flag anime items
        if (rowConfig.isAnime) {
          items.forEach(item => {
            item.isAnime = true;
          });
        }

        const rowData = {
          key: rowConfig.key,
          title: rowConfig.title,
          tileStyle: rowConfig.tileStyle,
          items: items,
          dropdownType: rowConfig.dropdownType || null
        };

        if (rowConfig.dropdownType === 'genre') {
          rowData.dropdownOptions = genreOptions;
          rowData.activeDropdownId = GENRE_CONFIG.defaultGenreId;
        } else if (rowConfig.dropdownType === 'provider') {
          rowData.dropdownOptions = PROVIDER_CONFIG.options;
          rowData.activeDropdownId = PROVIDER_CONFIG.defaultId;
        }

        results.push(rowData);
      } catch (err) {
        console.error(`Failed to fetch row ${rowConfig.key}:`, err);
      }
    }

    return results;
  }

  function normalizeGenreOptions(genres) {
    const byId = {};

    genres.forEach(genre => {
      if (!genre) return;
      const id = genre.id;
      const name = genre.name?.trim();
      if (id <= 0 || !name) return;

      byId[id] = { id, name };
    });

    const options = [];
    GENRE_CONFIG.preferredIds.forEach(genreId => {
      if (byId[genreId]) {
        options.push(byId[genreId]);
      }
    });

    if (options.length > 0) {
      return options;
    }

    return Object.values(byId).slice(0, 10);
  }

  function pickMediaItems(results, fallbackType, limit, allowMixed = false) {
    const items = [];

    for (const item of results) {
      if (!item) continue;

      const mediaType = normalizeMediaType(item, fallbackType);
      if (mediaType !== 'movie' && mediaType !== 'tv') continue;

      if (!allowMixed && fallbackType !== '' && mediaType !== fallbackType) continue;

      const hasImage = item.poster_path || item.backdrop_path;
      if (!hasImage) continue;

      item.mediaType = mediaType;
      items.push(item);

      if (items.length >= limit) break;
    }

    return items;
  }

  function normalizeMediaType(item, fallbackType = '') {
    const mediaType = item.media_type;
    if (mediaType === 'movie' || mediaType === 'tv') {
      return mediaType;
    }

    if (fallbackType === 'movie' || fallbackType === 'tv') {
      return fallbackType;
    }

    if (item.title || item.release_date) {
      return 'movie';
    }

    if (item.name || item.first_air_date) {
      return 'tv';
    }

    return '';
  }

  function bindEvents() {
    // Topbar scroll effect
    window.addEventListener("scroll", () => {
      els.topbar.classList.toggle("scrolled", window.scrollY > 30);
    }, { passive: true });

    // Hero buttons
    els.heroPlayBtn.addEventListener("click", () => {
      if (!state.featured) return;
      openPlayer(state.featuredType, state.featured.id);
    });

    els.heroDetailsBtn.addEventListener("click", () => {
      if (!state.featured) return;
      navigateTo(state.featuredType, state.featured.id);
    });

    // Search
    els.openSearchBtn.addEventListener("click", () => openSearch());
    els.searchCloseBtn.addEventListener("click", () => closeSearch());

    const searchFilterToggle = document.getElementById("searchFilterToggle");
    const searchFilterMenu = document.getElementById("searchFilterMenu");
    const searchFilterLabel = document.getElementById("searchFilterLabel");
    
    if (searchFilterToggle && searchFilterMenu) {
      searchFilterToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isHidden = searchFilterMenu.style.display === "none";
        searchFilterMenu.style.display = isHidden ? "flex" : "none";
        const chevron = searchFilterToggle.querySelector(".filter-chevron");
        if (chevron) chevron.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
      });

      document.addEventListener("click", (e) => {
        if (!searchFilterToggle.contains(e.target) && !searchFilterMenu.contains(e.target)) {
          searchFilterMenu.style.display = "none";
          const chevron = searchFilterToggle.querySelector(".filter-chevron");
          if (chevron) chevron.style.transform = "rotate(0deg)";
        }
      });

      const filterOpts = searchFilterMenu.querySelectorAll(".search-filter-option");
      filterOpts.forEach(btn => {
        btn.addEventListener("click", (e) => {
          filterOpts.forEach(b => {
            b.classList.remove("active");
            b.style.color = "#888";
          });
          btn.classList.add("active");
          btn.style.color = "#fff";
          searchFilterLabel.textContent = btn.textContent;
          searchFilterMenu.style.display = "none";
          const chevron = searchFilterToggle.querySelector(".filter-chevron");
          if (chevron) chevron.style.transform = "rotate(0deg)";
          
          state.searchFilter = btn.dataset.filter || 'all';
          const q = els.searchInput.value.trim();
          if (q.length >= 2) doSearch(q);
        });
      });
    }

    const clearBtn = document.getElementById("searchClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        els.searchInput.value = "";
        clearBtn.classList.add("hidden");
        renderRecentSearches();
        els.searchInput.focus();
      });
    }

    els.searchInput.addEventListener("input", () => {
      const q = els.searchInput.value.trim();
      if (clearBtn) {
        if (q.length > 0) clearBtn.classList.remove("hidden");
        else clearBtn.classList.add("hidden");
      }
      
      clearTimeout(state.searchDebounce);
      if (q.length < 2) {
        renderRecentSearches();
        return;
      }
      state.searchDebounce = setTimeout(() => doSearch(q), 300);
    });

    els.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = els.searchInput.value.trim();
        if (q.length >= 2) {
          saveRecentSearch(q);
        }
      }
    });

    // Search overlay click outside
    els.searchOverlay.addEventListener("click", (e) => {
      if (!e.target.closest(".search-container")) closeSearch();
    });

    // Rows click delegation
    els.rows.addEventListener("click", handleRowsClick);
    
    // Show overlay on touch (so it appears during scroll without requiring a click)
    els.rows.addEventListener("touchstart", (e) => {
      const card = e.target.closest(".card");
      if (card) {
        $$(".card.active-overlay").forEach(c => {
          if (c !== card) c.classList.remove("active-overlay");
        });
        card.classList.add("active-overlay");
      }
    }, {passive: true});

    // Mobile dock
    $$("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => {
        $$("[data-nav]").forEach(b => b.classList.remove("dock-active"));
        btn.classList.add("dock-active");
        const action = btn.dataset.nav;
        if (action === "home") window.scrollTo({ top: 0, behavior: "smooth" });
        if (action === "search") openSearch();
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (state.searchOpen) closeSearch();
      }
    });

  }

  function handleRowsClick(e) {
    // Tab click
    const tab = e.target.closest(".row-tab");
    if (tab) {
      e.preventDefault();
      switchTab(tab);
      return;
    }

    // Genre toggle
    const genreToggle = e.target.closest(".genre-toggle");
    if (genreToggle) {
      toggleGenreMenu(genreToggle);
      return;
    }

    // Genre option
    const genreOpt = e.target.closest(".genre-option");
    if (genreOpt) {
      e.preventDefault();
      selectGenre(genreOpt);
      return;
    }

    // Rail arrow
    const arrow = e.target.closest(".row-arrow");
    if (arrow) {
      scrollRail(arrow);
      return;
    }

    // Card click
    const card = e.target.closest(".card");
    if (card) {
      const id = Number(card.dataset.id);
      const type = card.dataset.type;
      const isAnime = card.dataset.anime === "1";
      const isResume = card.dataset.resume === "1";
      
      if (isResume) {
         let url = `/watch.html?type=${type}&id=${id}`;
         if (card.dataset.season && card.dataset.episode) {
            url += `&season=${card.dataset.season}&episode=${card.dataset.episode}`;
         }
         window.location.href = url;
         return;
      }
      
      if (isAnime) {
        handleAnimeClick(card);
      } else if (id && type) {
        navigateTo(type, id);
      }
    }
  }

  async function handleAnimeClick(card) {
    const id = Number(card.dataset.id);
    const type = card.dataset.type || "tv";
    const title = card.title || "";
    if (!id) return;

    showToast("Looking up anime...");

    try {
      const malId = await TMDB.lookupMalId(title);

      const base = window.APP_CONFIG?.APP_BASE || "";
      const target = new URL(`${base}/media.html`, window.location.origin);
      target.searchParams.set("type", type);
      target.searchParams.set("id", String(id));
      if (malId > 0) {
        target.searchParams.set("anime", "1");
        target.searchParams.set("malId", String(malId));
      } else {
        showToast("MAL ID not found, using regular source fallback.");
      }

      window.location.href = target.toString();
    } catch (err) {
      console.error(err);
      const base = window.APP_CONFIG?.APP_BASE || "";
      const target = new URL(`${base}/media.html`, window.location.origin);
      target.searchParams.set("type", type);
      target.searchParams.set("id", String(id));
      showToast("Failed to lookup anime, using regular source fallback.");
      window.location.href = target.toString();
    }
  }

  // ─── Hero ───
  async function setFeatured(item) {
    state.featured = item;
    state.featuredType = item.mediaType || inferType(item);

    let title = item.title || item.name || "Untitled";
    let year = (item.release_date || item.first_air_date || "").slice(0, 4);
    let rating = Number(item.vote_average || 0).toFixed(1);
    let typeLabel = state.featuredType === "tv" ? "TV Show" : "Movie";
    let backdrop = item.backdrop_path ? `${TMDB_BACKDROP}${item.backdrop_path}` : (item.poster_path ? `${TMDB_BACKDROP}${item.poster_path}` : "");
    let overview = item.overview;

    if (!overview && item.id) {
       try {
         const details = state.featuredType === 'tv' 
             ? await TMDB.getTVDetails(item.id) 
             : await TMDB.getMovieDetails(item.id);
         if (details) {
            overview = details.overview;
            item.overview = overview; // cache it on the item
            if (!item.backdrop_path && details.backdrop_path) {
                backdrop = `${TMDB_BACKDROP}${details.backdrop_path}`;
                item.backdrop_path = details.backdrop_path;
            }
         }
       } catch (err) {
         console.warn("Failed to fetch featured item details", err);
       }
    }

    // Prevent race conditions if featured item changed while fetching
    if (state.featured !== item) return;

    if (backdrop) {
      els.hero.style.backgroundImage = `url("${backdrop}")`;
    }

    els.heroTag.textContent = typeLabel;
    els.heroTitle.textContent = title;
    els.heroMeta.innerHTML = `
      <span class="rating">★ ${rating}</span>
      <span class="separator"></span>
      <span>${year}</span>
      <span class="separator"></span>
      <span class="tag">HD</span>
    `;
    els.heroOverview.textContent = overview || "No description available.";
  }

  function startHeroRotation() {
    if (state.heroTimer) clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => {
      if (state.searchOpen) return;
      state.heroIdx = (state.heroIdx + 1) % state.heroItems.length;
      setFeatured(state.heroItems[state.heroIdx]);
    }, 8000);
  }

  // ─── Rows ───
  function renderRows(rows) {
    els.rows.innerHTML = "";
    rows.forEach((row, idx) => {
      if (!row.items?.length) return;
      const el = buildRow(row, idx);
      els.rows.appendChild(el);
    });
    initRails();
  }

  function buildRow(row, idx) {
    const railId = `rail-${idx}`;
    const tileStyle = row.tileStyle || "poster";
    const rowKey = row.key || "";
    const isGenreRow = rowKey === "genre_dropdown";

    const section = document.createElement("section");
    section.className = "row";
    section.dataset.rowKey = rowKey;
    section.dataset.tileStyle = tileStyle;
    section.dataset.railId = railId;

    // Header
    const header = document.createElement("div");
    header.className = "row-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "row-title-group";

    const title = document.createElement("h2");
    title.className = "row-title";

    if (row.dropdownType) {
      title.innerHTML = buildDropdownPicker(row, railId);
    } else {
      title.textContent = row.title || "Collection";
    }
    titleGroup.appendChild(title);
    
    // Add "View All" link if it's the Provider or Genre row
    if (row.dropdownType === 'provider' || row.dropdownType === 'genre') {
        const viewAll = document.createElement("a");
        viewAll.className = "view-all-link";
        viewAll.style.cssText = "margin-left: 12px; font-size: 0.9rem; color: #e50914; text-decoration: none; font-weight: 500;";
        viewAll.textContent = "View All →";
        viewAll.href = `javascript:void(0)`;
        
        // Link to the browse page with current active ID
        viewAll.addEventListener("click", () => {
             const activeTab = section.querySelector(".row-tab.active")?.dataset.tab || "movie";
             const activeId = window.TMDB_STATE?.activeGenres?.[rowKey] || row.activeDropdownId;
             if (row.dropdownType === 'provider') {
                  window.location.href = `/browse.html?type=${activeTab}&provider=${activeId}`;
             } else {
                  window.location.href = `/browse.html?type=${activeTab}&genre=${activeId}`;
             }
        });
        
        // Store window state globally so we can access it from the click handler
        if (!window.TMDB_STATE) window.TMDB_STATE = { activeGenres: {} };
        viewAll.id = `view-all-${rowKey}`;
        titleGroup.appendChild(viewAll);
    }

    header.appendChild(titleGroup);

    // Tabs container
    const controls = document.createElement("div");
    controls.className = "row-controls";

    if (shouldShowTabs(rowKey)) {
      const tabs = buildTabs(rowKey);
      controls.appendChild(tabs);
    }

    header.appendChild(controls);
    section.appendChild(header);

    // Rail
    const railWrap = document.createElement("div");
    railWrap.className = "rail-container";

    // Overlay arrows inside railWrap
    railWrap.innerHTML = `
      <button class="row-arrow rail-arrow-left" data-target="${railId}" disabled aria-label="Scroll left">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <button class="row-arrow rail-arrow-right" data-target="${railId}" aria-label="Scroll right">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>
    `;

    const rail = document.createElement("div");
    rail.id = railId;
    rail.className = "card-rail";
    rail.dataset.tileStyle = tileStyle;

    row.items.forEach((item, i) => {
      rail.appendChild(buildCard(item, tileStyle, rowKey, i));
    });

    railWrap.appendChild(rail);
    section.appendChild(railWrap);

    return section;
  }

  function buildCard(item, tileStyle, rowKey, index) {
    const title = item.title || item.name || "Untitled";
    const type = item.mediaType || inferType(item);
    const isLandscape = tileStyle === "landscape";
    const img = isLandscape
      ? (item.backdrop_path || item.poster_path)
      : (item.poster_path || item.backdrop_path);
    const src = img ? `${(isLandscape ? TMDB_BACKDROP : TMDB_IMG)}${img}` : FALLBACK_POSTER;
    const isTop10 = rowKey === "top10" && item.rank > 0;
    const isAnime = item.isAnime === true;

    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    const rating = Number(item.vote_average || 0).toFixed(1);
    const typeLabel = isAnime ? "Anime" : (type === "tv" ? "TV" : "Movie");

    const card = document.createElement("button");
    card.className = `card ${isLandscape ? "card-landscape" : "card-poster"}`;
    card.type = "button";
    card.dataset.id = item.id;
    card.dataset.type = type;
    card.dataset.anime = isAnime ? "1" : "0";
    
    if (item.progressData) {
       card.dataset.resume = "1";
       if (item.season && item.episode) {
          card.dataset.season = item.season;
          card.dataset.episode = item.episode;
       }
    }
    
    card.title = title;

    let displayTitle = title;
    if (item.progressData && item.season && item.episode && type === "tv") {
       displayTitle = `${title} - S${item.season} E${item.episode}`;
    }

    let progressHtml = '';
    if (item.progressData && item.progressData.progress) {
       progressHtml = `<div style="width: 100%; height: 4px; background: rgba(255,255,255,0.2); position: absolute; bottom: 0; left: 0; z-index: 10;"><div style="width: ${item.progressData.progress}%; height: 100%; background: #e50914;"></div></div>`;
    }

    const genreText = item.genre_ids ? item.genre_ids.map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 3).join(", ") : "";
    const overview = item.overview || "";

    card.innerHTML = `
      <div class="card-img-wrap">
        <img class="card-image" src="${src}" alt="${esc(title)}" loading="lazy" decoding="async" />
        ${isTop10 ? `<span class="card-rank">${item.rank}</span>` : ""}
        ${progressHtml}
        <div class="card-overlay">
          <div class="card-overlay-content">
            <span class="card-overlay-title">${esc(displayTitle)}</span>
            <div class="card-overlay-meta">
              <span class="rating">★ ${rating}</span>
              ${genreText ? `<span class="genres">${esc(genreText)}</span>` : ""}
            </div>
            ${overview ? `<div class="card-overlay-desc">${esc(overview)}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="card-info">
        <span class="card-info-title">${esc(displayTitle)}</span>
        <span class="card-info-meta">★ ${rating} · ${year} · ${typeLabel}</span>
      </div>
    `;

    return card;
  }

  function shouldShowTabs(key) {
    return key.includes("trending") || key === "top_rated" || key === "genre_dropdown" || key === "provider_dropdown";
  }

  function buildTabs(rowKey) {
    const isMovie = rowKey.includes("movie") || rowKey === "trending_today" || rowKey === "top10" || rowKey === "top_rated" || rowKey === "genre_dropdown" || rowKey === "provider_dropdown";
    const wrap = document.createElement("div");
    wrap.className = "row-tabs";
    wrap.dataset.rowKey = rowKey;

    wrap.innerHTML = `
      <button class="row-tab ${isMovie ? "active" : ""}" data-tab="movie">Movies</button>
      <button class="row-tab ${!isMovie ? "active" : ""}" data-tab="tv">Series</button>
    `;
    return wrap;
  }

  async function switchTab(tab) {
    const tabsWrap = tab.closest(".row-tabs");
    if (!tabsWrap) return;

    const row = tab.closest(".row");
    if (!row) return;

    const targetTab = tab.dataset.tab;
    const currentTab = tabsWrap.querySelector(".row-tab.active")?.dataset.tab;
    if (targetTab === currentTab) return;

    // Update active state
    $$(".row-tab", tabsWrap).forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    const railId = row.dataset.railId;
    const rail = $(`#${railId}`);
    if (!rail) return;

    const rowKey = row.dataset.rowKey;
    const tileStyle = row.dataset.tileStyle || "poster";

    // Show loading state
    row.classList.add("row-loading");

    try {
      let items = [];
      if (rowKey === "genre_dropdown") {
        const genreId = state.activeGenres[rowKey] || GENRE_CONFIG.defaultGenreId;
        const data = targetTab === "tv"
          ? await TMDB.discoverTV(genreId)
          : await TMDB.discoverMovies(genreId);
        items = pickMediaItems(data.results || [], targetTab, 14, false);
      } else if (rowKey === "provider_dropdown") {
        const providerId = state.activeGenres[rowKey] || PROVIDER_CONFIG.defaultId;
        const data = await TMDB.discoverByProvider(targetTab, providerId);
        items = pickMediaItems(data.results || [], targetTab, 14, false);
      } else {
        // Fetch based on row type
        let data;
        if (rowKey === "top10") {
          data = await TMDB.getTrending('all', 'week');
        } else if (rowKey === "trending_today") {
          data = targetTab === "tv"
            ? await TMDB.getTrending('tv', 'week')
            : await TMDB.getTrending('movie', 'week');
        } else if (rowKey === "top_rated") {
          data = targetTab === "tv"
            ? await TMDB.getTopRatedTV()
            : await TMDB.getTopRatedMovies();
        } else {
          data = targetTab === "tv"
            ? await TMDB.getTrending('tv', 'week')
            : await TMDB.getTrending('movie', 'week');
        }
        items = pickMediaItems(data.results || [], targetTab, 14, rowKey === "top10");
      }

      rail.innerHTML = "";
      items.forEach((item, i) => {
        if (!item.mediaType) item.mediaType = targetTab;
        rail.appendChild(buildCard(item, tileStyle, rowKey, i));
      });
      rail.scrollLeft = 0;
      updateArrows(rail);
    } catch (err) {
      console.error(err);
      showToast("Failed to load content.");
    } finally {
      row.classList.remove("row-loading");
    }
  }

  // ─── Dropdown Picker ───
  function buildDropdownPicker(row, railId) {
    const options = row.dropdownOptions || [];
    const activeId = row.activeDropdownId || options[0]?.id || 8;
    const activeName = options.find(o => o.id === activeId)?.name || "Select";

    // Track state
    state.activeGenres = state.activeGenres || {};
    state.activeGenres[row.key] = activeId;

    const isProvider = row.dropdownType === 'provider';

    const menuItems = options.map(opt => {
      let iconHtml = '';
      if (isProvider && opt.logo_path) {
        iconHtml = `<img src="${TMDB_IMG}${opt.logo_path}" class="provider-logo" alt="${esc(opt.name)}" loading="lazy" />`;
      }
      return `<button class="genre-option ${opt.id === activeId ? "active" : ""}" data-genre-id="${opt.id}" data-target="${railId}" data-type="${row.dropdownType}">${iconHtml}<span>${esc(opt.name)}</span></button>`;
    }).join("");

    return `
      <div class="genre-picker" data-genre-picker>
        <button class="genre-toggle" type="button" data-genre-toggle>
          <span class="genre-label">${esc(isProvider ? 'Only on ' + activeName : activeName)}</span>
          <svg class="genre-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="genre-menu${isProvider ? ' genre-menu--provider' : ''} hidden" data-genre-menu>${menuItems}</div>
      </div>
    `;
  }

  function toggleGenreMenu(toggle) {
    const picker = toggle.closest("[data-genre-picker]");
    if (!picker) return;
    const menu = picker.querySelector("[data-genre-menu]");
    if (!menu) return;

    const isOpening = menu.classList.contains("hidden");
    closeAllGenreMenus();

    if (isOpening) {
      menu.classList.remove("hidden");
      picker.classList.add("open");

      // Close on outside click
      const close = (e) => {
        if (!picker.contains(e.target)) {
          menu.classList.add("hidden");
          picker.classList.remove("open");
          document.removeEventListener("click", close);
        }
      };
      setTimeout(() => document.addEventListener("click", close), 0);
    }
  }

  function closeAllGenreMenus() {
    $$("[data-genre-menu]").forEach(m => m.classList.add("hidden"));
    $$("[data-genre-picker]").forEach(p => p.classList.remove("open"));
  }

  async function selectGenre(option) {
    const dropdownId = Number(option.dataset.genreId);
    const dropdownType = option.dataset.type;
    const railId = option.dataset.target;
    if (!dropdownId || !railId) return;

    const picker = option.closest("[data-genre-picker]");
    const row = option.closest(".row");
    const rail = $(`#${railId}`);
    if (!row || !rail) return;

    const tileStyle = row.dataset.tileStyle || "poster";
    const rowKey = row.dataset.rowKey || "";
    const activeTab = row.querySelector(".row-tab.active")?.dataset.tab || "movie";

    // Update UI
    const label = picker?.querySelector(".genre-label");
    if (label) {
      label.textContent = dropdownType === 'provider' ? 'Only on ' + option.textContent.trim() : option.textContent.trim();
    }
    $$(`[data-genre-menu] .genre-option`, row).forEach(o => o.classList.remove("active"));
    option.classList.add("active");

        state.activeGenres[rowKey] = dropdownId;
        
        // Add a "View All" link if it's a provider or genre dropdown
        if (state.currentCategory !== 'all') { // Avoid adding view all logic unless they want to
          // Actually, let's just make clicking the label do it, or add a link
        }
    if (!window.TMDB_STATE) window.TMDB_STATE = { activeGenres: {} };
    window.TMDB_STATE.activeGenres[rowKey] = dropdownId;
    closeAllGenreMenus();

    // Fetch
    row.classList.add("row-loading");
    try {
      let data;
      if (dropdownType === 'provider') {
        data = await TMDB.discoverByProvider(activeTab, dropdownId);
      } else {
        data = activeTab === "tv"
          ? await TMDB.discoverTV(dropdownId)
          : await TMDB.discoverMovies(dropdownId);
      }
      const items = pickMediaItems(data.results || [], activeTab, 14, false);

      rail.innerHTML = "";
      items.forEach((item, i) => {
        if (!item.mediaType) item.mediaType = activeTab;
        rail.appendChild(buildCard(item, tileStyle, rowKey, i));
      });
      rail.scrollLeft = 0;
      updateArrows(rail);
    } catch (err) {
      console.error(err);
      showToast("Failed to load genre content.");
    } finally {
      row.classList.remove("row-loading");
    }
  }

  // ─── Rails ───
  function initRails() {
    $$(".card-rail").forEach(rail => {
      rail.addEventListener("scroll", () => updateArrows(rail), { passive: true });
      enableDrag(rail);
      updateArrows(rail);
    });

    window.addEventListener("resize", () => {
      $$(".card-rail").forEach(r => updateArrows(r));
    }, { passive: true });
  }

  function scrollRail(btn) {
    const targetId = btn.dataset.target;
    const rail = $(`#${targetId}`);
    if (!rail) return;

    const isLeft = btn.classList.contains("rail-arrow-left");
    const amount = rail.clientWidth * 0.8;
    rail.scrollBy({ left: isLeft ? -amount : amount, behavior: "smooth" });
    setTimeout(() => updateArrows(rail), 300);
  }

  function updateArrows(rail) {
    const wrap = rail.closest(".rail-container");
    if (!wrap) return;
    const row = rail.closest(".row");
    if (!row) return;

    const leftBtn = row.querySelector(".rail-arrow-left");
    const rightBtn = row.querySelector(".rail-arrow-right");
    const maxScroll = rail.scrollWidth - rail.clientWidth;

    if (leftBtn) leftBtn.disabled = rail.scrollLeft <= 4;
    if (rightBtn) rightBtn.disabled = rail.scrollLeft >= maxScroll - 4;
  }

  function enableDrag() {
    // Drag-to-scroll removed — touchpad users scroll natively,
    // mouse users use wheel (enableWheel) or arrow buttons.
  }

  // ─── Search ───
  function loadRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem('recentSearches')) || [];
    } catch {
      return [];
    }
  }

  function saveRecentSearch(query) {
    if (!query || query.trim() === '') return;
    let recents = loadRecentSearches();
    recents = recents.filter(q => q.toLowerCase() !== query.toLowerCase());
    recents.unshift(query);
    if (recents.length > 5) recents.pop();
    localStorage.setItem('recentSearches', JSON.stringify(recents));
  }

  function clearRecentSearches() {
    localStorage.removeItem('recentSearches');
    renderRecentSearches();
  }

  function renderRecentSearches() {
    const recents = loadRecentSearches();
    const clearBtn = document.getElementById('searchClearBtn');
    if (els.searchInput.value.trim() !== '') {
      if (clearBtn) clearBtn.classList.remove('hidden');
      return;
    }
    if (clearBtn) clearBtn.classList.add('hidden');

    if (!recents.length) {
      els.searchResults.innerHTML = '';
      return;
    }

    const listHtml = recents.map(q => `
      <div class="recent-search-item" data-query="${esc(q)}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 12px; opacity: 0.7;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>${esc(q)}</span>
      </div>
    `).join('');

    els.searchResults.innerHTML = `
      <div class="recent-searches-container">
        <div class="recent-searches-header">
          <span class="recent-title">RECENT</span>
          <button class="recent-clear-btn" type="button" onclick="window.clearRecentSearches()">Clear</button>
        </div>
        <div class="recent-searches-list">
          ${listHtml}
        </div>
      </div>
    `;

    $$('.recent-search-item', els.searchResults).forEach(item => {
      item.addEventListener('click', () => {
        els.searchInput.value = item.dataset.query;
        if (clearBtn) clearBtn.classList.remove('hidden');
        doSearch(item.dataset.query);
      });
    });
  }

  window.clearRecentSearches = clearRecentSearches;

  function openSearch() {
    state.searchOpen = true;
    els.searchOverlay.classList.remove("hidden");
    els.searchInput.value = "";
    renderRecentSearches();
    requestAnimationFrame(() => els.searchInput.focus());
  }

  function closeSearch() {
    state.searchOpen = false;
    els.searchOverlay.classList.add("hidden");
    els.searchInput.value = "";
    els.searchResults.innerHTML = "";
  }


  async function doSearch(query) {
    try {
      // Determine API endpoint based on filter
      let endpoint = '/search/multi';
      if (state.searchFilter === 'movie') endpoint = '/search/movie';
      if (state.searchFilter === 'tv') endpoint = '/search/tv';
      if (state.searchFilter === 'person') endpoint = '/search/person';

      const data = await TMDB.get(endpoint, { query, page: 1, include_adult: false });
      let results = [];
      
      // Extract known_for for persons, otherwise keep movies and tv
      (data.results || []).forEach(item => {
        // Since /search/movie and /search/tv don't return media_type in all items, inject it
        const type = item.media_type || (state.searchFilter === 'movie' ? 'movie' : (state.searchFilter === 'tv' ? 'tv' : null));
        
        if ((item.media_type === 'person' || state.searchFilter === 'person') && item.known_for) {
          results.push(...item.known_for.filter(kf => (kf.media_type === 'movie' || kf.media_type === 'tv') && (kf.poster_path || kf.backdrop_path)));
        } else if ((type === 'movie' || type === 'tv') && (item.poster_path || item.backdrop_path)) {
          item.media_type = type;
          results.push(item);
        }
      });
      
      // Deduplicate by ID just in case
      const seen = new Set();
      results = results.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, 20);

      if (!results.length) {
        els.searchResults.innerHTML = `<p class="search-empty" style="padding: 20px; color: #888; text-align: center;">No results for "${esc(query)}"</p>`;
        return;
      }

      els.searchResults.innerHTML = results.map(item => {
        const title = item.title || item.name || "Untitled";
        const year = (item.release_date || item.first_air_date || "").slice(0, 4);
        const type = item.media_type === "tv" ? "TV Show" : "Movie";
        const poster = item.poster_path ? `${TMDB_IMG}${item.poster_path}` : FALLBACK_POSTER;
        const rating = Number(item.vote_average || 0).toFixed(1);
        const overview = item.overview || "No description available.";

        return `
          <div class="search-item" data-id="${item.id}" data-type="${item.media_type}">
            <div class="search-item-header">
              <img class="search-item-poster" src="${poster}" alt="${esc(title)}" loading="lazy" />
              <div class="search-item-info">
                <div class="search-item-title">${esc(title)}</div>
                <div class="search-item-meta">${type} | ${year} | <span>★ ${rating}</span></div>
              </div>
              <div class="search-item-chevron">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <div class="search-item-details">
              <div class="search-item-desc">${esc(overview)}</div>
              <div class="search-item-actions">
                <button class="search-play-btn" data-action="play">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play
                </button>
                <button class="search-more-btn" data-action="more">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg> See more
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("");

      // Bind clicks for accordion and actions
      $$(".search-item", els.searchResults).forEach(item => {
        const header = item.querySelector('.search-item-header');
        header.addEventListener("click", () => {
          const isExpanded = item.classList.contains("expanded");
          $$(".search-item.expanded", els.searchResults).forEach(el => el.classList.remove("expanded"));
          if (!isExpanded) {
            item.classList.add("expanded");
          }
        });

        const id = Number(item.dataset.id);
        const type = item.dataset.type;

        item.querySelector('.search-play-btn')?.addEventListener("click", (e) => {
          e.stopPropagation();
          closeSearch();
          openPlayer(type, id);
        });

        item.querySelector('.search-more-btn')?.addEventListener("click", (e) => {
          e.stopPropagation();
          closeSearch();
          navigateTo(type, id);
        });
      });
    } catch (err) {
      console.error(err);
      showToast("Search failed.");
    }
  }

  // ─── Player ───
  function openPlayer(type, id) {
    if (!id) return;
    
    let url = `/watch.html?type=${type}&id=${id}`;
    
    // For anime lookup from home page, it uses TMDB search but wait, home page openPlayer doesn't easily know if it's anime unless passed in.
    // However, watch.js handles the TMDB id seamlessly for videasy (it uses tmdb ids for movies and tv, and anilist for anime, which home.js doesn't fetch yet for search).
    
    window.location.href = url;
  }



  function navigateTo(type, id) {
    if (!id) return;
    if (type !== "movie" && type !== "tv") return;
    const base = window.APP_CONFIG?.APP_BASE || "";
    const target = `${base}/media.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    window.location.href = target;
  }

  function inferType(item) {
    return (item.title || item.release_date) ? "movie" : "tv";
  }

  function esc(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.add("hidden"), 3000);
  }
})();
