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
    activeGenres: {}
  };

  // Genre configuration
  const GENRE_CONFIG = {
    preferredIds: [35, 878, 53, 16, 80, 14, 9648, 99, 10751, 36],
    defaultGenreId: 35,
    defaultGenreTitle: 'Comedy'
  };

  // Home rows configuration
  const HOME_ROWS = [
    { key: 'top10', title: 'Top 10 Today', fetchFn: () => TMDB.getTrending('all', 'day'), fallbackType: '', limit: 10, allowMixed: true, tileStyle: 'poster' },
    { key: 'trending_today', title: 'Trending Today', fetchFn: () => TMDB.getTrending('all', 'week'), fallbackType: '', limit: 14, allowMixed: true, tileStyle: 'landscape' },
    { key: 'top_rated', title: 'Top rated', fetchFn: () => TMDB.getTopRatedMovies(), fallbackType: 'movie', limit: 14, allowMixed: false, tileStyle: 'landscape' },
    { key: 'anime', title: 'Anime', fetchFn: () => TMDB.discoverAnime(), fallbackType: '', limit: 14, allowMixed: true, tileStyle: 'poster', isAnime: true },
    { key: 'genre_dropdown', title: GENRE_CONFIG.defaultGenreTitle, fetchFn: () => TMDB.discoverMovies(GENRE_CONFIG.defaultGenreId), fallbackType: 'movie', limit: 14, allowMixed: false, tileStyle: 'landscape' }
  ];

  init();

  async function init() {
    bindEvents();

    try {
      const rows = await fetchAllRows();
      state.rowsData = rows;
      renderRows(rows);

      const firstRow = rows.find(r => r.items?.length > 0);
      if (firstRow) {
        state.heroItems = firstRow.items.slice(0, 10);
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
    for (const rowConfig of HOME_ROWS) {
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
          items: items
        };

        // Add genre options for genre dropdown
        if (rowConfig.key === 'genre_dropdown') {
          rowData.genreOptions = genreOptions;
          rowData.activeGenreId = GENRE_CONFIG.defaultGenreId;
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

    els.searchInput.addEventListener("input", () => {
      const q = els.searchInput.value.trim();
      clearTimeout(state.searchDebounce);
      if (q.length < 2) {
        els.searchResults.innerHTML = "";
        return;
      }
      state.searchDebounce = setTimeout(() => doSearch(q), 250);
    });

    // Search overlay click outside
    els.searchOverlay.addEventListener("click", (e) => {
      if (!e.target.closest(".search-container")) closeSearch();
    });

    // Player modal
    $(`[data-close]`, els.playerModal)?.addEventListener("click", () => closeModal());
    els.playerModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => closeModal());

    // Rows click delegation
    els.rows.addEventListener("click", handleRowsClick);

    // Mobile dock
    $$("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => {
        $$("[data-nav]").forEach(b => b.classList.remove("dock-active"));
        btn.classList.add("dock-active");
        const action = btn.dataset.nav;
        if (action === "home") window.scrollTo({ top: 0, behavior: "smooth" });
        if (action === "search") openSearch();
        if (action === "browse") document.getElementById("rowsWrap")?.scrollIntoView({ behavior: "smooth" });
      });
    });

    // Modal
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (state.searchOpen) closeSearch();
        else closeModal();
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
  function setFeatured(item) {
    state.featured = item;
    state.featuredType = item.mediaType || inferType(item);

    const title = item.title || item.name || "Untitled";
    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    const rating = Number(item.vote_average || 0).toFixed(1);
    const typeLabel = state.featuredType === "tv" ? "TV Show" : "Movie";
    const backdrop = item.backdrop_path ? `${TMDB_BACKDROP}${item.backdrop_path}` : (item.poster_path ? `${TMDB_BACKDROP}${item.poster_path}` : "");

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
    els.heroOverview.textContent = item.overview || "No description available.";
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

    if (isGenreRow) {
      title.innerHTML = buildGenrePicker(row, railId);
    } else {
      title.textContent = row.title || "Collection";
    }
    titleGroup.appendChild(title);

    // Tabs for rows that support them
    if (shouldShowTabs(rowKey)) {
      const tabs = buildTabs(rowKey);
      titleGroup.appendChild(tabs);
    }

    header.appendChild(titleGroup);

    // Arrow controls
    const controls = document.createElement("div");
    controls.className = "row-controls";
    controls.innerHTML = `
      <button class="row-arrow rail-arrow-left" data-target="${railId}" disabled aria-label="Scroll left">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <button class="row-arrow rail-arrow-right" data-target="${railId}" aria-label="Scroll right">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>
    `;
    header.appendChild(controls);

    section.appendChild(header);

    // Rail
    const railWrap = document.createElement("div");
    railWrap.className = "rail-container";

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
    card.title = title;

    card.innerHTML = `
      <div class="card-img-wrap">
        <img class="card-image" src="${src}" alt="${esc(title)}" loading="lazy" decoding="async" />
        ${isTop10 ? `<span class="card-rank">${item.rank}</span>` : ""}
        <div class="card-overlay">
          <span class="card-overlay-title">${esc(title)}</span>
        </div>
      </div>
      <div class="card-info">
        <span class="card-info-title">${esc(title)}</span>
        <span class="card-info-meta">★ ${rating} · ${year} · ${typeLabel}</span>
      </div>
    `;

    return card;
  }

  function shouldShowTabs(key) {
    return key.includes("trending") || key === "top_rated" || key === "genre_dropdown";
  }

  function buildTabs(rowKey) {
    const isMovie = rowKey.includes("movie") || rowKey === "trending_today" || rowKey === "top10" || rowKey === "top_rated" || rowKey === "genre_dropdown";
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

  // ─── Genre Picker ───
  function buildGenrePicker(row, railId) {
    const options = row.genreOptions || [];
    const activeId = row.activeGenreId || GENRE_CONFIG.defaultGenreId;
    const activeName = options.find(o => o.id === activeId)?.name || "Genre";

    state.activeGenres[row.key] = activeId;

    const menuItems = options.map(opt =>
      `<button class="genre-option ${opt.id === activeId ? "active" : ""}" data-genre-id="${opt.id}" data-target="${railId}">${esc(opt.name)}</button>`
    ).join("");

    return `
      <div class="genre-picker" data-genre-picker>
        <button class="genre-toggle" type="button" data-genre-toggle>
          <span class="genre-label">${esc(activeName)}</span>
          <svg class="genre-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="genre-menu hidden" data-genre-menu>${menuItems}</div>
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
    const genreId = Number(option.dataset.genreId);
    const railId = option.dataset.target;
    if (!genreId || !railId) return;

    const picker = option.closest("[data-genre-picker]");
    const row = option.closest(".row");
    const rail = $(`#${railId}`);
    if (!row || !rail) return;

    const tileStyle = row.dataset.tileStyle || "poster";
    const rowKey = row.dataset.rowKey || "";
    const activeTab = row.querySelector(".row-tab.active")?.dataset.tab || "movie";

    // Update UI
    const label = picker?.querySelector(".genre-label");
    if (label) label.textContent = option.textContent.trim();
    $$(`[data-genre-menu] .genre-option`, row).forEach(o => o.classList.remove("active"));
    option.classList.add("active");

    state.activeGenres[rowKey] = genreId;
    closeAllGenreMenus();

    // Fetch
    row.classList.add("row-loading");
    try {
      const data = activeTab === "tv"
        ? await TMDB.discoverTV(genreId)
        : await TMDB.discoverMovies(genreId);
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
      enableWheel(rail);
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

  function enableWheel(rail) {
    rail.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (rail.scrollWidth <= rail.clientWidth + 2) return;
      const atLeft = rail.scrollLeft <= 0;
      const atRight = rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
      if ((e.deltaY < 0 && atLeft) || (e.deltaY > 0 && atRight)) return;
      e.preventDefault();
      rail.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  // ─── Search ───
  function openSearch() {
    state.searchOpen = true;
    els.searchOverlay.classList.remove("hidden");
    els.searchInput.value = "";
    els.searchResults.innerHTML = "";
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
      const data = await TMDB.searchMulti(query);
      const results = (data.results || []).filter(item => {
        const mediaType = item.media_type;
        return (mediaType === 'movie' || mediaType === 'tv') && (item.poster_path || item.backdrop_path);
      }).slice(0, 18);

      if (!results.length) {
        els.searchResults.innerHTML = `<p class="search-empty">No results for "${esc(query)}"</p>`;
        return;
      }

      els.searchResults.innerHTML = results.map(item => {
        const title = item.title || item.name || "Untitled";
        const year = (item.release_date || item.first_air_date || "").slice(0, 4);
        const type = item.media_type === "tv" ? "TV Show" : "Movie";
        const poster = item.poster_path ? `${TMDB_IMG}${item.poster_path}` : FALLBACK_POSTER;

        return `
          <button class="search-item" type="button" data-id="${item.id}" data-type="${item.media_type}">
            <img class="search-item-poster" src="${poster}" alt="${esc(title)}" loading="lazy" />
            <div class="search-item-info">
              <div class="search-item-title">${esc(title)}</div>
              <div class="search-item-meta">${type} · ${year}</div>
            </div>
          </button>
        `;
      }).join("");

      // Bind clicks
      $$(".search-item", els.searchResults).forEach(item => {
        item.addEventListener("click", () => {
          const id = Number(item.dataset.id);
          const type = item.dataset.type;
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

    const src = buildVidlinkUrl(type, id);
    if (!src || !els.playerModal || !els.trailerFrame) return;

    els.playerModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      els.trailerFrame.src = src;
    });
  }

  function closeModal() {
    if (!els.playerModal || !els.trailerFrame) return;

    els.playerModal.classList.add("hidden");
    document.body.style.overflow = "";
    els.trailerFrame.src = "";
  }

  // ─── Helpers ───
  function buildVidlinkUrl(type, id) {
    const params = "primaryColor=B20710&secondaryColor=170000&iconColor=eefdec&icons=default&player=default&title=false&poster=true&autoplay=true";

    if (type === "anime") {
      return `https://vidlink.pro/anime/${id}/1/sub?${params}&nextbutton=true`;
    }

    if (type === "tv") {
      return `https://vidlink.pro/tv/${id}/1/1?${params}&nextbutton=true`;
    }

    if (type === "movie") {
      return `https://vidlink.pro/movie/${id}?${params}`;
    }

    return "";
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
