(() => {
  "use strict";

  const config = window.TMDB_CONFIG || {};
  const TMDB_IMG = config.IMAGE_BASE || "https://image.tmdb.org/t/p/w500";
  const FALLBACK_POSTER = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1a1a1a"/><text x="50%" y="50%" fill="#555" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14">No Image</text></svg>'
  );

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
  };
  
  const els = {
    topbar: $("#topbar"),
    browseTitle: $("#browseTitle"),
    browseSubtitle: $("#browseSubtitle"),
    browseGrid: $("#browseGrid"),
    loader: $("#loader"),
    endMessage: $("#endMessage"),
    toast: $("#toast"),
    searchOverlay: $("#searchOverlay"),
    openSearchBtn: $("#openSearchBtn"),
    searchCloseBtn: $("#searchCloseBtn"),
    
    typeFilter: $("#typeFilter"),
    genreFilter: $("#genreFilter"),
    providerFilter: $("#providerFilter")
  };

  const state = {
    page: 1,
    totalPages: 1,
    isLoading: false,
    hasMore: true,
    params: new URLSearchParams(window.location.search),
    type: "movie",
    genre: "all",
    provider: "all",
    genresById: {}
  };

  const PROVIDER_NAMES = {
    "all": "All Sources",
    "vivamax": "Vivamax",
    "8": "Netflix",
    "9": "Prime Video",
    "1899": "Max",
    "337": "Disney+",
    "350": "Apple TV+",
    "531": "Paramount+",
    "15": "Hulu",
    "283": "Crunchyroll",
    "158": "Viu",
    "511": "iWantTFC",
    "160": "iflix"
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  async function init() {
    els.topbar.classList.toggle("scrolled", window.scrollY > 30);
    bindEvents();
    
    if (state.params.has("type")) state.type = state.params.get("type");
    if (state.params.has("genre")) state.genre = state.params.get("genre");
    if (state.params.has("provider")) state.provider = state.params.get("provider");
    
    if (els.typeFilter) els.typeFilter.value = state.type;
    if (els.providerFilter) els.providerFilter.value = state.provider;

    await updateGenreOptions();
    if (els.genreFilter) els.genreFilter.value = state.genre;

    updateHeader();
    await loadInitialData();

    // Fix active nav states for anime
    if (state.type === 'anime') {
      const activeNavs = document.querySelectorAll(".nav-active, .dock-active");
      activeNavs.forEach(el => el.classList.remove("nav-active", "dock-active"));
      
      const animeNavs = document.querySelectorAll('a[href="/browse.html?type=anime"]');
      animeNavs.forEach(el => {
        if (el.classList.contains("nav-link")) el.classList.add("nav-active");
        if (el.classList.contains("dock-btn")) el.classList.add("dock-active");
      });
    }
  }

  function bindEvents() {
    window.addEventListener("scroll", () => {
      els.topbar.classList.toggle("scrolled", window.scrollY > 30);
      handleScroll();
    }, { passive: true });

    if (els.browseGrid) {
      els.browseGrid.addEventListener("touchstart", (e) => {
        const card = e.target.closest(".card");
        if (card) {
          $$(".card.active-overlay").forEach(c => {
            if (c !== card) c.classList.remove("active-overlay");
          });
          card.classList.add("active-overlay");
        }
      }, {passive: true});

      els.browseGrid.addEventListener("click", (e) => {
        const card = e.target.closest(".card");
        if (card) {
          const id = Number(card.dataset.id);
          const type = card.dataset.type;
          const isAnime = card.dataset.anime 
          const isAnimebool = card.dataset.anime === "1";
          
          if (isAnimebool) {
              handleAnimeClick(card);
          } else if (id && type) {
            const base = window.APP_CONFIG && window.APP_CONFIG.APP_BASE ? window.APP_CONFIG.APP_BASE : "";
            window.location.href = base + "/media.html?type=" + type + "&id=" + id;
          }
        }
      });
    }

    if (els.typeFilter) {
      els.typeFilter.addEventListener("change", async (e) => {
        state.type = e.target.value;
        state.genre = "all";
        await updateGenreOptions();
        triggerFilterChange();
      });
    }

    if (els.genreFilter) {
      els.genreFilter.addEventListener("change", (e) => {
        state.genre = e.target.value;
        triggerFilterChange();
      });
    }

    if (els.providerFilter) {
      els.providerFilter.addEventListener("change", (e) => {
        state.provider = e.target.value;
        triggerFilterChange();
      });
    }
    
    // Search overlay logic is now handled by search.js
  }

  async function handleAnimeClick(card) {
    const id = Number(card.dataset.id);
    const type = card.dataset.type || "tv";
    const title = card.title || "";
    if (!id) return;

    showToast("Looking up anime...");
    try {
      const malId = await TMDB.lookupMalId(title);
      const base = window.APP_CONFIG && window.APP_CONFIG.APP_BASE ? window.APP_CONFIG.APP_BASE : "";
      const target = new URL(base + "/media.html", window.location.origin);
      target.searchParams.set("type", type);
      target.searchParams.set("id", String(id));
      if (malId > 0) {
        target.searchParams.set("anime", "1");
        target.searchParams.set("malId", String(malId));
      }
      window.location.href = target.toString();
    } catch (err) {
      window.location.href = (window.APP_CONFIG && window.APP_CONFIG.APP_BASE ? window.APP_CONFIG.APP_BASE : "") + "/media.html?type=" + type + "&id=" + id;
    }
  }

  function triggerFilterChange() {
    const url = new URL(window.location);
    url.searchParams.set("type", state.type);
    
    if (state.genre !== "all") url.searchParams.set("genre", state.genre);
    else url.searchParams.delete("genre");
    
    if (state.provider !== "all") url.searchParams.set("provider", state.provider);
    else url.searchParams.delete("provider");
    
    window.history.pushState({ path: url.toString() }, "", url.toString());

    updateHeader();
    loadInitialData();
  }

  async function updateGenreOptions() {
    if (!els.genreFilter) return;
    let html = '<option value="all">All Genres</option>';
    state.genresById = {};
    if (state.type === "anime") {
        html += '<option value="16">Animation</option>';
        state.genresById["16"] = "Animation";
    } else {
        try {
            const data = state.type === "tv" ? await TMDB.getTVGenres() : await TMDB.getMovieGenres();
            if (data && data.genres) {
                data.genres.forEach(n => {
                    state.genresById[n.id] = n.name;
                    html += '<option value="' + n.id + '">' + n.name + '</option>';
                });
            }
        } catch(e) {
            console.error("Genre fetch error", e);
        }
    }
    els.genreFilter.innerHTML = html;
    els.genreFilter.value = "all";
  }

  function updateHeader() {
    let titleStr = "";
    let subStr = "";
    
    if (state.type === "anime") titleStr = "Anime";
    else if (state.type === "tv") titleStr = "TV Shows";
    else titleStr = "Movies";
    
    if (state.genre !== "all" && state.genresById[state.genre]) {
        titleStr = state.genresById[state.genre] + " " + titleStr;
    }
    
    if (state.provider !== "all" && PROVIDER_NAMES[state.provider]) {
        subStr = "Only on " + PROVIDER_NAMES[state.provider];
    } else {
        subStr = "Discover everything";
    }
    
    if (els.browseTitle) els.browseTitle.textContent = titleStr;
    if (els.browseSubtitle) els.browseSubtitle.textContent = subStr;
  }

  async function handleScroll() {
    if (state.isLoading || !state.hasMore) return;
    
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 800) {
      if (state.page < state.totalPages) {
        state.page++;
        await fetchAndRenderData();
      } else {
        state.hasMore = false;
        if (els.endMessage) els.endMessage.classList.remove("hidden");
        if (els.loader) els.loader.classList.add("hidden");
      }
    }
  }

  function renderSkeletonGrid() {
    if (!els.browseGrid) return;
    els.browseGrid.innerHTML = "";
    for (let i = 0; i < 20; i++) {
      const card = document.createElement("div");
      card.className = "skeleton-card card-poster";
      els.browseGrid.appendChild(card);
    }
  }

  async function loadInitialData() {
    renderSkeletonGrid();
    state.page = 1;
    state.isLoading = true;
    if (els.loader) els.loader.classList.add("hidden"); // Hide default spinner for first load
    if (els.endMessage) els.endMessage.classList.add("hidden");
    state.hasMore = true;

    await fetchAndRenderData();
  }

  async function fetchAndRenderData() {
    if (!state.hasMore) return;
    
    state.isLoading = true;
    if (els.loader) els.loader.classList.remove("hidden");
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const params = {
          page: state.page,
          sort_by: "popularity.desc",
          include_adult: false
      };
      
      let endpointType = state.type;
      
      if (state.genre && state.genre !== "all") {
          params.with_genres = state.genre;
      }
      
      if (state.provider && state.provider !== "all") {
          if (state.provider === "vivamax") {
              params.with_companies = "149142|173083";
          } else {
              params.with_watch_providers = state.provider;
              params.watch_region = "PH";
          }
      }

      if (state.type === "anime") {
          endpointType = "tv";
          params.with_genres = params.with_genres ? params.with_genres + ",16" : 16;
          params.with_original_language = "ja";
      }

      if (endpointType === "tv") {
          params['first_air_date.lte'] = today;
      } else {
          params['primary_release_date.lte'] = today;
      }

      const data = await TMDB.discoverAdvanced(endpointType, params);
      
      state.totalPages = data.total_pages || 1;
      const results = data.results || [];
      
      if (results.length === 0) {
        state.hasMore = false;
        if (els.endMessage) els.endMessage.classList.remove("hidden");
      } else {
        if (state.page === 1 && els.browseGrid) els.browseGrid.innerHTML = ""; // Clear skeletons
        results.forEach(item => {
          const type = state.type === "anime" ? (item.media_type || "tv") : (item.media_type || state.type);
          item.mediaType = type;
          if (state.type === "anime") item.isAnime = true;
          if (els.browseGrid) els.browseGrid.appendChild(buildCard(item));
        });
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to load more content.");
    } finally {
      state.isLoading = false;
      if (els.loader) els.loader.classList.add("hidden");
    }
  }

  function buildCard(item) {
    const title = item.title || item.name || "Untitled";
    const type = item.mediaType;
    const isAnime = item.isAnime === true;
    const img = item.poster_path || item.backdrop_path;
    const src = img ? TMDB_IMG + img : FALLBACK_POSTER;
    const year = (item.release_date || item.first_air_date || "").slice(0, 4);
    const rating = Number(item.vote_average || 0).toFixed(1);
    const typeLabel = isAnime ? "Anime" : (type === "tv" ? "TV" : "Movie");

    const card = document.createElement("button");
    card.className = "card card-poster";
    card.type = "button";
    card.dataset.id = item.id;
    card.dataset.type = type;
    card.dataset.anime = isAnime ? "1" : "0";
    card.title = title;

    const genreText = item.genre_ids ? item.genre_ids.map(id => GENRE_MAP[id]).filter(Boolean).slice(0, 3).join(", ") : "";
    const overview = item.overview || "";

    card.innerHTML = `
      <div class="card-img-wrap">
        <img class="card-image" src="${src}" alt="${esc(title)}" loading="lazy" decoding="async" />
        <div class="card-overlay">
          <div class="card-overlay-content">
            <span class="card-overlay-title">${esc(title)}</span>
            <div class="card-overlay-meta">
              <span class="rating">★ ${rating}</span>
              ${genreText ? `<span class="genres">${esc(genreText)}</span>` : ""}
            </div>
            ${overview ? `<div class="card-overlay-desc">${esc(overview)}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="card-info">
        <span class="card-info-title">${esc(title)}</span>
        <span class="card-info-meta">★ ${rating} · ${year} · ${typeLabel}</span>
      </div>
    `;

    return card;
  }

  function esc(str) {
    if (!str) return "";
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
    return str.replace(/[&<>\"']/g, m => map[m]);
  }

  function showToast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    els.toast.classList.add("show");
    
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
      setTimeout(() => els.toast.classList.add("hidden"), 300);
    }, 3000);
  }
})();

