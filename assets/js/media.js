(() => {
  "use strict";

  const config = window.TMDB_CONFIG || {};
  const TMDB_IMG = config.IMAGE_BASE || "https://image.tmdb.org/t/p/w500";
  const TMDB_BACKDROP = config.BACKDROP_BASE || "https://image.tmdb.org/t/p/original";
  const FALLBACK_POSTER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><rect width="300" height="450" fill="#1a1a1a"/><text x="50%" y="50%" fill="#555" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14">No Image</text></svg>`
  )}`;

  // Get type and ID from injected context, query string, or URL path
  let type = 'movie';
  let id = 0;
  let animeMalId = 0;
  let isAnimeMode = false;

  if (window.MEDIA_CONTEXT) {
    type = window.MEDIA_CONTEXT.type;
    id = window.MEDIA_CONTEXT.id;
  } else {
    const url = new URL(window.location.href);
    const queryType = (url.searchParams.get('type') || '').toLowerCase();
    const queryId = parseInt(url.searchParams.get('id') || '0', 10);
    isAnimeMode = url.searchParams.get('anime') === '1';
    animeMalId = parseInt(url.searchParams.get('malId') || '0', 10);

    if ((queryType === 'movie' || queryType === 'tv' || queryType === 'anime') && queryId > 0) {
      type = queryType;
      id = queryId;
    } else {
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      // Grab the last two parts to handle sub-directories (e.g. /STREAMMOVIES/tv/123)
      if (pathParts.length >= 2) {
        const urlType = pathParts[pathParts.length - 2].toLowerCase();
        const urlId = parseInt(pathParts[pathParts.length - 1], 10);
        if ((urlType === 'movie' || urlType === 'tv' || urlType === 'anime') && urlId > 0) {
          type = urlType;
          id = urlId;
        }
      }
    }
  }

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const els = {
    hero: $("#mediaHero"),
    heroVideoWrap: $("#heroVideoWrap"),
    heroTrailerBg: $("#heroTrailerBg"),
    heroTitle: $("#heroTitle"),
    heroTitleWrap: $(".hero-title-wrap"),
    heroTitleLogo: $("#heroTitleLogo"),
    heroMeta: $("#heroMeta"),
    heroOverview: $("#heroOverview"),
    heroMetaCompact: $("#heroMetaCompact"),
    playBtn: $("#playBtn"),
    episodesBtn: $("#episodesBtn"),
    similarBtn: $("#similarBtn"),
    backBtn: $("#backBtn"),
    muteBtn: $("#muteBtn"),
    actorsGrid: $("#actorsGrid"),
    recommendGrid: $("#recommendGrid"),
    episodesBlock: $("#episodesBlock"),
    seasonSelect: $("#seasonSelect"),
    episodeSearch: $("#episodeSearch"),
    episodesList: $("#episodesList"),
    playerModal: $("#playerModal"),
    trailerFrame: $("#trailerFrame"),
    toast: $("#toast")
  };

  const state = {
    details: null,
    trailerKey: null,
    heroMuted: true,
    heroLoadedKey: null,
    currentSeason: 1,
    descTimer: null,
    isAnimeMode,
    animeMalId
  };

  init();

  async function init() {
    bindEvents();

    if (!id) {
      showToast("Invalid media ID.");
      return;
    }

    try {
      let details;
      if (type === "tv") {
        details = await TMDB.getTVDetails(id);
      } else {
        details = await TMDB.getMovieDetails(id);
      }

      state.details = details;
      state.trailerKey = pickTrailer(
        (details.videos && details.videos.results) || []
      );

      renderHero(details);
      renderActors(details);
      renderRecommendations(details);
      renderHeroTrailer();
    } catch (err) {
      console.error(err);
      showToast("Failed to load details.");
      els.heroTitle.textContent = "Error loading content";
      els.heroOverview.textContent = "Please go back and try again.";
    }
  }

  function bindEvents() {
    // Back button
    els.backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        const base = window.APP_CONFIG?.HOME_URL || "/";
        window.location.href = base;
      }
    });

    // Mute toggle
    els.muteBtn.addEventListener("click", () => {
      state.heroMuted = !state.heroMuted;
      updateMuteBtn();
      postToiframe(state.heroMuted ? "mute" : "unMute");
      showToast(state.heroMuted ? "Muted" : "Unmuted");
    });

    // Play button
    els.playBtn.addEventListener("click", () => {
      openPlayer();
    });

    // Episodes button
    els.episodesBtn.addEventListener("click", () => {
      els.episodesBlock.classList.toggle("hidden");
      if (!els.episodesBlock.classList.contains("hidden")) {
        els.episodesBlock.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    // Similar button
    els.similarBtn.addEventListener("click", () => {
      els.recommendGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Player modal
    $(`[data-close]`, els.playerModal)?.addEventListener("click", () => closeModal());
    els.playerModal?.querySelector(".modal-backdrop")?.addEventListener("click", () => closeModal());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // Recommendations click
    els.recommendGrid.addEventListener("click", (e) => {
      const card = e.target.closest("[data-id][data-type]");
      if (!card) return;
      const nextId = Number(card.dataset.id);
      const nextType = card.dataset.type;
      if (nextId && (nextType === "movie" || nextType === "tv")) {
        const base = window.APP_CONFIG?.APP_BASE || "";
        window.location.href = `${base}/media.html?type=${encodeURIComponent(nextType)}&id=${encodeURIComponent(nextId)}`;
      }
    });
  }

  // ─── Hero ───
  function renderHero(details) {
    const title = details.title || details.name || "Untitled";
    const year = (details.release_date || details.first_air_date || "").slice(0, 4);
    const rating = Number(details.vote_average || 0).toFixed(1);

    let runtime = "";
    const raw = details.runtime || (Array.isArray(details.episode_run_time) && details.episode_run_time[0]);
    if (raw) {
      const h = Math.floor(raw / 60);
      const m = raw % 60;
      runtime = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    const genres = Array.isArray(details.genres)
      ? details.genres.slice(0, 3).map(g => g.name)
      : [];

    const backdrop = details.backdrop_path || details.poster_path;
    if (backdrop) {
      els.hero.style.backgroundImage = `url("${TMDB_BACKDROP}${backdrop}")`;
    }

    // Title logo or text
    const logos = details.images?.logos || [];
    const logo = logos.find(l => l.iso_639_1 === "en") || logos[0];
    if (logo?.file_path) {
      els.heroTitleLogo.src = TMDB_IMG + logo.file_path;
      els.heroTitleLogo.alt = title + " Logo";
      els.heroTitleLogo.classList.remove("hidden");
      els.heroTitle.classList.add("hidden");
    } else {
      els.heroTitle.textContent = title;
      els.heroTitleLogo.classList.add("hidden");
      els.heroTitle.classList.remove("hidden");
    }

    // Meta
    const meta = [];
    meta.push(`<span class="rating">★ ${rating}</span>`);
    meta.push(`<span class="sep"></span>`);
    meta.push(`<span>${year}</span>`);
    if (runtime) {
      meta.push(`<span class="sep"></span>`);
      meta.push(`<span>${runtime}</span>`);
    }
    meta.push(`<span class="sep"></span>`);
    meta.push(`<span class="tag">HD</span>`);
    genres.forEach(g => {
      meta.push(`<span class="sep"></span>`);
      meta.push(`<span>${esc(g)}</span>`);
    });
    els.heroMeta.innerHTML = meta.join("");
    els.heroOverview.textContent = details.overview || "No description available.";

    // Compact meta (shown after description fades on mobile)
    const compactMeta = [];
    compactMeta.push(`<span class="rating">★ ${rating}</span>`);
    compactMeta.push(`<span class="sep"></span>`);
    compactMeta.push(`<span>${year}</span>`);
    if (runtime) {
      compactMeta.push(`<span class="sep"></span>`);
      compactMeta.push(`<span>${runtime}</span>`);
    }
    genres.forEach(g => {
      compactMeta.push(`<span class="sep"></span>`);
      compactMeta.push(`<span>${esc(g)}</span>`);
    });
    els.heroMetaCompact.innerHTML = compactMeta.join("");

    // Auto-hide description after 4 seconds on mobile
    if (window.innerWidth <= 768) {
      clearTimeout(state.descTimer);
      els.heroOverview.classList.remove("fade-out");
      els.heroMetaCompact.classList.remove("visible");
      state.descTimer = setTimeout(() => {
        els.heroOverview.classList.add("fade-out");
        els.heroMetaCompact.classList.add("visible");
      }, 4000);
    }

    // TV-specific
    if (type === "tv") {
      els.episodesBtn.classList.remove("hidden");
      setupEpisodes(details);
    }
  }

  function renderHeroTrailer() {
    if (!state.trailerKey) {
      els.hero.classList.remove("has-trailer");
      els.heroVideoWrap.classList.add("hidden");
      els.heroTrailerBg.src = "";
      state.heroLoadedKey = null;
      els.heroTitleWrap?.classList.remove("hidden");
      return;
    }

    const src = buildTrailerUrl(state.trailerKey, {
      autoplay: "1", mute: "1", controls: "0",
      rel: "0", modestbranding: "1", playsinline: "1",
      iv_load_policy: "3", disablekb: "1", fs: "0",
      loop: "1", playlist: state.trailerKey
    });

    if (state.heroLoadedKey !== state.trailerKey) {
      els.heroTrailerBg.src = src;
      state.heroLoadedKey = state.trailerKey;

      // Handle trailer load errors (e.g., country restrictions)
      els.heroTrailerBg.onerror = function() {
        console.warn("Trailer failed to load (may be region-locked)");
        els.hero.classList.remove("has-trailer");
        els.heroVideoWrap.classList.add("hidden");
        els.heroTitleWrap?.classList.remove("hidden");
      };
    }

    els.heroTitleWrap?.classList.add("hidden");

    els.hero.classList.add("has-trailer");
    els.heroVideoWrap.classList.remove("hidden");
    els.muteBtn.classList.remove("hidden");
    updateMuteBtn();
  }

  function updateMuteBtn() {
    els.muteBtn.innerHTML = state.heroMuted
      ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
  }

  function postToiframe(func) {
    if (els.heroTrailerBg?.contentWindow) {
      els.heroTrailerBg.contentWindow.postMessage(
        JSON.stringify({ event: "command", func, args: [] }), "*"
      );
    }
  }

  // ─── Episodes ───
  function setupEpisodes(details) {
    const seasons = Array.isArray(details.seasons) ? details.seasons : [];
    els.seasonSelect.innerHTML = "";

    seasons.forEach(s => {
      if (s.season_number === 0) return;
      const opt = document.createElement("option");
      opt.value = s.season_number;
      opt.textContent = s.name || `Season ${s.season_number}`;
      els.seasonSelect.appendChild(opt);
    });

    if (els.seasonSelect.options.length > 0) {
      state.currentSeason = Number(els.seasonSelect.options[0].value);
      els.seasonSelect.value = state.currentSeason;
    }

    els.seasonSelect.addEventListener("change", () => {
      state.currentSeason = Number(els.seasonSelect.value);
      loadSeason(state.currentSeason);
    });

    els.episodeSearch.addEventListener("input", () => {
      const q = els.episodeSearch.value.trim().toLowerCase();
      $$(".episode-card", els.episodesList).forEach(card => {
        const title = (card.dataset.title || "").toLowerCase();
        const overview = (card.dataset.overview || "").toLowerCase();
        card.style.display = (!q || title.includes(q) || overview.includes(q)) ? "" : "none";
      });
    });

    els.episodesBlock.classList.remove("hidden");
    loadSeason(state.currentSeason);
  }

  async function loadSeason(seasonNum) {
    if (!id || !seasonNum) return;
    els.episodesList.innerHTML = '<p class="empty-msg">Loading episodes...</p>';

    try {
      const data = await TMDB.getTVSeasonDetails(id, seasonNum);
      const episodes = data.episodes || [];
      renderEpisodes(episodes);
    } catch (err) {
      console.error(err);
      els.episodesList.innerHTML = '<p class="empty-msg">Failed to load episodes.</p>';
    }
  }

  function renderEpisodes(episodes) {
    if (!episodes.length) {
      els.episodesList.innerHTML = '<p class="empty-msg">No episodes available.</p>';
      return;
    }

    els.episodesList.innerHTML = episodes.map(ep => {
      const num = ep.episode_number || 0;
      const title = ep.name || `Episode ${num}`;
      const overview = ep.overview || "No description available.";
      const still = ep.still_path ? `${TMDB_BACKDROP}${ep.still_path}` : "";
      const runtime = ep.runtime ? `${ep.runtime}m` : "";

      return `
        <div class="episode-card" data-ep="${num}" data-title="${esc(title)}" data-overview="${esc(overview)}">
          <div class="ep-thumb-wrap">
            ${still ? `<img class="ep-thumb" src="${still}" alt="Episode ${num}" loading="lazy" />` : `<div class="ep-thumb"></div>`}
            <span class="ep-number">E${String(num).padStart(2, "0")}</span>
            <div class="ep-play-overlay">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="white"><path d="M8 5v14l11-7z"></path></svg>
            </div>
          </div>
          <div class="ep-info">
            <p class="ep-title">${esc(title)}</p>
            <p class="ep-overview">${esc(overview)}</p>
            ${runtime ? `<p class="ep-runtime">${runtime}</p>` : ""}
          </div>
        </div>
      `;
    }).join("");

    // Episode click
    $$(".episode-card", els.episodesList).forEach(card => {
      card.addEventListener("click", () => {
        const epNum = Number(card.dataset.ep);
        if (!epNum) return;
        openPlayer({ episode: epNum });
      });
    });
  }

  // ─── Actors ───
  function renderActors(details) {
    const cast = details.credits?.cast?.slice(0, 12) || [];

    if (!cast.length) {
      els.actorsGrid.innerHTML = '<p class="empty-msg">No cast information available.</p>';
      return;
    }

    els.actorsGrid.innerHTML = cast.map(actor => {
      const name = actor.name || "Unknown";
      const role = actor.character || "Actor";
      const img = actor.profile_path ? `${TMDB_IMG}${actor.profile_path}` : FALLBACK_POSTER;

      return `
        <div class="actor-card">
          <img class="actor-image" src="${img}" alt="${esc(name)}" loading="lazy" />
          <div class="actor-info">
            <p class="actor-name">${esc(name)}</p>
            <p class="actor-role">${esc(role)}</p>
          </div>
        </div>
      `;
    }).join("");
  }

  // ─── Recommendations ───
  function renderRecommendations(details) {
    const candidateLists = [];

    if (details.recommendations?.results) {
      candidateLists.push(details.recommendations.results);
    }

    if (details.similar?.results) {
      candidateLists.push(details.similar.results);
    }

    const items = [];
    const seen = new Set();

    for (const list of candidateLists) {
      for (const item of list) {
        if (!item) continue;

        const hasImage = item.poster_path || item.backdrop_path;
        if (!hasImage) continue;

        const itemMedia = item.media_type || type;
        if (itemMedia !== 'movie' && itemMedia !== 'tv') continue;

        const dedupeKey = `${itemMedia}:${item.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        item.mediaType = itemMedia;
        items.push(item);

        if (items.length >= 24) break;
      }
      if (items.length >= 24) break;
    }

    if (!items.length) {
      els.recommendGrid.innerHTML = '<p class="empty-msg">No recommendations available.</p>';
      return;
    }

    els.recommendGrid.innerHTML = items.map(item => {
      const title = item.title || item.name || "Untitled";
      const year = (item.release_date || item.first_air_date || "").slice(0, 4);
      const rating = Number(item.vote_average || 0).toFixed(1);
      const mediaType = item.mediaType === "tv" ? "tv" : "movie";
      const img = item.backdrop_path || item.poster_path;
      const src = img ? `${TMDB_BACKDROP}${img}` : FALLBACK_POSTER;

      return `
        <button class="recommend-card" type="button" data-id="${item.id}" data-type="${mediaType}">
          <img class="recommend-thumb" src="${src}" alt="${esc(title)}" loading="lazy" />
          <p class="recommend-title">${esc(title)}</p>
          <p class="recommend-meta">★ ${rating} · ${year} · ${mediaType === "tv" ? "TV Show" : "Movie"}</p>
        </button>
      `;
    }).join("");
  }

  // ─── Player ───
  function openPlayer(options = {}) {
    const episode = Number(options.episode || 1);
    const season = Number(options.season || state.currentSeason || 1);
    const useAnimeEndpoint = state.isAnimeMode && state.animeMalId > 0;
    const playbackType = useAnimeEndpoint ? "anime" : type;
    const playbackId = useAnimeEndpoint ? state.animeMalId : id;
    const src = buildVidlinkUrl({ type: playbackType, id: playbackId, season, episode });
    showPlayer(src);
  }

  function closeModal() {
    if (!els.playerModal || !els.trailerFrame) return;

    els.playerModal.classList.add("hidden");
    document.body.style.overflow = "";
    els.trailerFrame.src = "";
  }

  // ─── Helpers ───
  function showPlayer(src) {
    if (!src || !els.playerModal || !els.trailerFrame) return;

    els.playerModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      els.trailerFrame.src = src;
    });
  }

  function buildVidlinkUrl({ type, id, season = 1, episode = 1 }) {
    const params = "primaryColor=B20710&secondaryColor=170000&iconColor=eefdec&icons=default&player=default&title=false&poster=true&autoplay=true";

    if (type === "anime") {
      return `https://vidlink.pro/anime/${id}/${episode}/sub?${params}&nextbutton=true&fallback=true`;
    }

    if (type === "tv") {
      return `https://vidlink.pro/tv/${id}/${season}/${episode}?${params}&nextbutton=true`;
    }

    if (type === "movie") {
      return `https://vidlink.pro/movie/${id}?${params}`;
    }

    return "";
  }

  function pickTrailer(videos) {
    return videos.find(v => v.site === "YouTube" && v.type === "Trailer" && v.official)?.key
      || videos.find(v => v.site === "YouTube" && v.type === "Trailer")?.key
      || videos.find(v => v.site === "YouTube" && v.type === "Teaser")?.key
      || null;
  }

  function buildTrailerUrl(key, params = {}) {
    const search = new URLSearchParams({
      enablejsapi: "1",
      origin: window.location.origin,
      ...params
    });
    return `https://www.youtube.com/embed/${key}?${search.toString()}`;
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
