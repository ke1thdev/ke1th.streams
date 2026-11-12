(() => {
  "use strict";

  const config = window.TMDB_CONFIG || {};
  const TMDB_IMG = path => window.SiteImages.tmdb(path, 'w500');
  const TMDB_BACKDROP = path => window.SiteImages.tmdb(path, 'w1280');
  const useBackgroundTrailer = !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    (/Chrom(?:e|ium)\//.test(navigator.userAgent) || !matchMedia("(pointer: coarse)").matches);
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

  if (type === "anime") {
    type = "tv";
    isAnimeMode = true;
  }

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const els = {
    hero: $("#mediaHero"),
    heroBackdrop: $("#mediaBackdrop"),
    heroVideoWrap: $("#heroVideoWrap"),
    heroTrailerBg: $("#heroTrailerBg"),
    heroTitle: $("#heroTitle"),
    heroTitleWrap: $(".hero-title-wrap"),
    heroTitleLogo: $("#heroTitleLogo"),
    heroMeta: $("#heroMeta"),
    heroOverview: $("#heroOverview"),
    heroActions: $(".hero-actions"),
    playBtn: $("#playBtn"),
    playLabel: $("#playLabel"),
    episodesBtn: $("#episodesBtn"),
    similarBtn: $("#similarBtn"),
    watchLaterBtn: $("#watchLaterBtn"),
    watchLaterLabel: $("#watchLaterLabel"),
    shareBtn: $("#shareBtn"),
    thumbsUpBtn: $("#thumbsUpBtn"),
    thumbsDownBtn: $("#thumbsDownBtn"),
    backBtn: $("#backBtn"),
    muteBtn: $("#muteBtn"),
    actorsGrid: $("#actorsGrid"),
    recommendGrid: $("#recommendGrid"),
    episodesBlock: $("#episodesBlock"),
    seasonSelect: $("#seasonSelect"),
    episodeSearch: $("#episodeSearch"),
    episodesList: $("#episodesList"),
    toast: $("#toast")
  };

  const state = {
    details: null,
    trailerKey: null,
    heroMuted: true,
    heroLoadedKey: null,
    currentSeason: 1,
    descTimer: null
  };

  const watchLabels = {
    started: "Started",
    watching: "In progress",
    finished: "Finished",
    "up-next": "Up next"
  };

  init();

  async function init() {
    bindEvents();

    if (!id) {
      showToast("Invalid media ID.");
      return;
    }

    renderHeroSkeleton();

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
      updateWatchLaterBtn();
      updateRateBtns();
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
      const base = window.APP_CONFIG?.HOME_URL || "/";
      window.location.href = base;
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
      const resume = window.WatchHistory?.getResume(type, id);
      window.location.href = playerUrl(resume || {});
    });
    window.addEventListener("pageshow", refreshWatchPresentation);
    window.addEventListener("storage", refreshWatchPresentation);

    // Episodes button
    els.episodesBtn.addEventListener("click", () => {
      els.episodesBlock.classList.remove("hidden");
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      els.episodesBlock.scrollIntoView({ behavior, block: "start" });
    });

    // Similar button
    els.similarBtn.addEventListener("click", () => {
      els.recommendGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Watch Later button
    if (els.watchLaterBtn) {
      els.watchLaterBtn.addEventListener("click", () => {
        if (!state.details) return;
        let list = [];
        try {
          list = JSON.parse(localStorage.getItem('watchLater')) || [];
        } catch (e) {}
        
        const idx = list.findIndex(item => String(item.id) === String(id) && item.mediaType === type);
        if (idx > -1) {
          list.splice(idx, 1);
          showToast("Removed from Watch Later");
        } else {
          list.unshift({
            id: id,
            type: type,
            title: state.details.title || state.details.name,
            overview: state.details.overview,
            poster_path: state.details.poster_path,
            backdrop_path: state.details.backdrop_path,
            vote_average: state.details.vote_average,
            release_date: state.details.release_date || state.details.first_air_date,
            mediaType: type,
            isAnime: isAnimeMode
          });
          showToast("Added to Watch Later");
        }
        localStorage.setItem('watchLater', JSON.stringify(list));
        updateWatchLaterBtn();
      });
    }

    // Share button
    if (els.shareBtn) {
      els.shareBtn.addEventListener("click", async () => {
        const base = window.APP_CONFIG?.APP_BASE || "";
        let url = `${window.location.origin}${base}/media.html?type=${type}&id=${id}`;
        if (isAnimeMode && animeMalId > 0) {
          url += `&anime=1&malId=${animeMalId}`;
        }
        
        const shareTitle = state.details ? (state.details.title || state.details.name) : "ke1th.streams";
        const shareDesc = state.details ? state.details.overview : "";
        const combinedText = `Watch ${shareTitle} on ke1th.streams\n\n${shareDesc}\n\n${url}`;

        const shareData = {
          title: shareTitle,
          text: combinedText
        };

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        if (isMobile && navigator.share) {
          try {
            await navigator.share(shareData);
            return;
          } catch (err) {
            // User likely cancelled the share; fallback to copy
          }
        }
        
        // Fallback for desktop browsers / non-secure contexts
        const fallbackCopy = (text) => {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          textArea.style.opacity = "0";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
            if (document.execCommand('copy')) showToast("Link copied to clipboard!");
            else showToast("Failed to copy link.");
          } catch (err) {
            showToast("Failed to copy link.");
          }
          document.body.removeChild(textArea);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(() => {
            showToast("Link copied to clipboard!");
          }).catch(() => fallbackCopy(url));
        } else {
          fallbackCopy(url);
        }
      });
    }

    // Rate buttons
    if (els.thumbsUpBtn) {
      els.thumbsUpBtn.addEventListener("click", () => handleRating(10));
    }
    if (els.thumbsDownBtn) {
      els.thumbsDownBtn.addEventListener("click", () => handleRating(1));
    }

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

  function renderHeroSkeleton() {
    if (els.heroTitle) {
      els.heroTitle.innerHTML = `<div class="skeleton skeleton-text" style="height: 1.2em; width: 60%; margin-bottom: 0;"></div>`;
      els.heroTitle.classList.remove("hidden");
    }
    if (els.heroTitleLogo) els.heroTitleLogo.classList.add("hidden");
    if (els.heroOverview) els.heroOverview.innerHTML = `<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div>`;
    if (els.heroMeta) els.heroMeta.innerHTML = `<div class="skeleton skeleton-text" style="height: 1em; width: 200px;"></div>`;
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
    window.SiteImages.background(els.heroBackdrop, backdrop, 'w1280', details.poster_path);

    // Title logo or text
    const logos = details.images?.logos || [];
    const logo = logos.find(l => l.iso_639_1 === "en") || logos[0];
    els.heroTitle.textContent = title;
    els.heroTitle.classList.remove("hidden");
    els.heroTitleLogo.classList.add("hidden");
    if (logo?.file_path) {
      els.heroTitleLogo.alt = title + " Logo";
      window.SiteImages.setImage(els.heroTitleLogo, logo.file_path, 'w500', {
        onLoad() {
          els.heroTitleLogo.classList.remove("hidden");
          els.heroTitle.classList.add("hidden");
        },
        onError() {
          els.heroTitleLogo.classList.add("hidden");
          els.heroTitle.classList.remove("hidden");
        }
      });
    } else {
      window.SiteImages.setImage(els.heroTitleLogo, '');
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
    if (type === "movie") {
      meta.push('<span id="movieWatchState" class="watch-state liquid-glass-bar" data-glisse-surface hidden><span class="watch-state-label"></span></span>');
    }
    els.heroMeta.innerHTML = meta.join("");
    refreshWatchPresentation();
    els.heroOverview.textContent = details.overview || "No description available.";

    // TV-specific
    if (type === "tv") {
      els.episodesBtn.classList.remove("hidden");
      setupEpisodes(details);
    }
    
    // Update Page Title and Meta Tags for browsers
    document.title = `${title} (${year}) - ke1th.streams`;
    
    const metaTitle = document.querySelector('meta[property="og:title"]');
    if (metaTitle) metaTitle.content = `${title} - ke1th.streams`;
    
    const metaDesc = document.querySelector('meta[property="og:description"]');
    if (metaDesc && details.overview) metaDesc.content = details.overview;
    
    const metaImg = document.querySelector('meta[property="og:image"]');
    if (metaImg && backdrop) metaImg.content = TMDB_BACKDROP(backdrop);
    
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) twitterTitle.content = `${title} - ke1th.streams`;
    
    const twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc && details.overview) twitterDesc.content = details.overview;
    
    const twitterImg = document.querySelector('meta[name="twitter:image"]');
    if (twitterImg && backdrop) twitterImg.content = TMDB_BACKDROP(backdrop);
  }

  function renderHeroTrailer() {
    if (!state.trailerKey || !useBackgroundTrailer) {
      els.hero.classList.remove("has-trailer");
      els.heroVideoWrap.classList.add("hidden");
      els.heroTrailerBg.removeAttribute("src");
      els.muteBtn.classList.add("hidden");
      state.heroLoadedKey = null;
      els.heroTitleWrap?.classList.remove("hidden");
      return;
    }

    const src = buildTrailerUrl(state.trailerKey, {
      autoplay: "1", mute: "1", controls: "0",
      rel: "0", modestbranding: "1", playsinline: "1",
      iv_load_policy: "3", disablekb: "1", fs: "0",
      showinfo: "0", cc_load_policy: "0"
    });

    if (state.heroLoadedKey !== state.trailerKey) {
      els.heroTrailerBg.src = src;
      state.heroLoadedKey = state.trailerKey;

      // Handle trailer load errors (e.g., country restrictions)
      els.heroTrailerBg.onerror = function() {
        console.warn("Trailer failed to load (may be region-locked)");
        els.hero.classList.remove("has-trailer");
        els.heroVideoWrap.classList.add("hidden");
      };
    }

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
    const seasons = (Array.isArray(details.seasons) ? details.seasons : [])
      .filter(s => s && Number(s.season_number) > 0)
      .sort((a, b) => Number(a.season_number) - Number(b.season_number));
    els.seasonSelect.innerHTML = "";

    seasons.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.season_number;
      opt.textContent = s.name || `Season ${s.season_number}`;
      els.seasonSelect.appendChild(opt);
    });

    if (els.seasonSelect.options.length > 0) {
      const resumeSeason = Number(window.WatchHistory?.getResume(type, id)?.season || 1);
      state.currentSeason = seasons.some(s => Number(s.season_number) === resumeSeason)
        ? resumeSeason
        : Number(els.seasonSelect.options[0].value);
      els.seasonSelect.value = state.currentSeason;
    }

    els.seasonSelect.addEventListener("change", () => {
      state.currentSeason = Number(els.seasonSelect.value);
      loadSeason(state.currentSeason);
    });

    els.episodeSearch.addEventListener("input", filterEpisodes);

    els.episodesBlock.classList.remove("hidden");
    loadSeason(state.currentSeason);
  }

  async function loadSeason(seasonNum) {
    if (!id || !seasonNum) return;
    els.episodesList.innerHTML = '<p class="empty-msg">Loading episodes...</p>';

    try {
      const data = await TMDB.getTVSeasonDetails(id, seasonNum);
      if (state.currentSeason !== seasonNum) return;
      const episodes = (data.episodes || []).filter(ep => Number(ep?.episode_number) > 0);
      renderEpisodes(episodes);
    } catch (err) {
      if (state.currentSeason !== seasonNum) return;
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
      const num = Number(ep.episode_number);
      const title = ep.name || `Episode ${num}`;
      const overview = ep.overview || "No description available.";
      const episodeArtwork = ep.still_path || state.details?.backdrop_path || state.details?.poster_path;
      const still = episodeArtwork ? TMDB_BACKDROP(episodeArtwork) : "";
      const runtime = ep.runtime ? `${ep.runtime}m` : "";

      return `
        <a class="episode-card" href="${esc(playerUrl({ episode: num }))}" data-ep="${num}"
          aria-label="Play episode ${num}, ${esc(title)}" aria-describedby="episode-state-${num}">
          <div class="ep-thumb-wrap">
            ${still ? `<img class="ep-thumb" src="${esc(still)}" alt="" loading="lazy" ${window.SiteImages.attrs(episodeArtwork, 'w1280', state.details?.backdrop_path || state.details?.poster_path)} />` : ""}
            <span class="ep-number" aria-hidden="true">E${String(num).padStart(2, "0")}</span>
            <div class="ep-play-overlay" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
            </div>
            <span id="episode-state-${num}" class="watch-state episode-watch-state liquid-glass-bar" data-glisse-surface hidden>
              <span class="watch-state-label"></span>
            </span>
            <span class="ep-progress" aria-hidden="true" hidden></span>
          </div>
          <div class="ep-info">
            <span class="ep-title">${esc(title)}</span>
            <span class="ep-overview">${esc(overview)}</span>
            ${runtime ? `<span class="ep-runtime">${esc(runtime)}</span>` : ""}
          </div>
        </a>
      `;
    }).join("");

    refreshWatchPresentation();
    filterEpisodes();
  }

  function filterEpisodes() {
    const query = els.episodeSearch.value.trim().toLowerCase();
    for (const card of $$(".episode-card", els.episodesList)) {
      const title = $(".ep-title", card).textContent.toLowerCase();
      const overview = $(".ep-overview", card).textContent.toLowerCase();
      card.hidden = Boolean(query && !title.includes(query) && !overview.includes(query) && card.dataset.ep !== query);
    }
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
      const img = actor.profile_path ? TMDB_IMG(actor.profile_path) : FALLBACK_POSTER;

      return `
        <div class="actor-card">
          <img class="actor-image" src="${img}" alt="${esc(name)}" loading="lazy" ${window.SiteImages.attrs(actor.profile_path, 'w500')} />
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
      const src = img ? TMDB_BACKDROP(img) : FALLBACK_POSTER;

      return `
        <button class="recommend-card" type="button" data-id="${item.id}" data-type="${mediaType}">
          <img class="recommend-thumb" src="${src}" alt="${esc(title)}" loading="lazy" ${window.SiteImages.attrs(img, 'w1280', item.poster_path)} />
          <p class="recommend-title">${esc(title)}</p>
          <p class="recommend-meta">★ ${rating} · ${year} · ${mediaType === "tv" ? "TV Show" : "Movie"}</p>
        </button>
      `;
    }).join("");
  }

  // ─── Player ───
  function refreshWatchPresentation() {
    const history = window.WatchHistory;
    if (!history || !id) return;
    const resume = history.getResume(type, id);
    const movie = type === "movie" ? history.get({ type, id }) : null;
    let playLabel = "Play";
    if (resume) {
      if (type === "tv") {
        const action = resume.status === "up-next" ? "Play" : "Resume";
        playLabel = `${action} S${resume.season} E${resume.episode}`;
      } else {
        playLabel = "Resume";
      }
    } else if (movie?.status === "finished") {
      playLabel = "Watch again";
    }
    els.playLabel.textContent = playLabel;

    const movieBadge = $("#movieWatchState");
    if (movieBadge) updateWatchBadge(movieBadge, movie);

    for (const card of $$(".episode-card", els.episodesList)) {
      const record = history.get({ type, id, season: state.currentSeason, episode: Number(card.dataset.ep) });
      updateWatchBadge($(".episode-watch-state", card), record);
      const progress = Math.min(100, Math.max(0, Number(record?.progress) || 0));
      const bar = $(".ep-progress", card);
      bar.hidden = record?.status !== "watching" || progress === 0;
      bar.style.setProperty("--episode-progress", progress + "%");
    }
  }

  function updateWatchBadge(badge, record) {
    const label = watchLabels[record?.status] || "";
    badge.hidden = !label;
    badge.dataset.status = record?.status || "";
    const labelEl = $(".watch-state-label", badge);
    if (labelEl.textContent !== label) labelEl.textContent = label;
  }

  function playerUrl(options = {}) {
    const episode = Number(options.episode || 1);
    const season = Number(options.season ?? state.currentSeason);
    
    let url = `watch.html?type=${type}&id=${id}`;
    if (type === 'tv') {
      url += `&season=${season}&episode=${episode}`;
    }
    
    // Anime fallback parameters
    if (isAnimeMode || options.isAnime) {
      url += "&anime=1";
      const malId = Number(options.malId) || animeMalId;
      if (malId > 0) url += `&malId=${malId}`;
    }

    return url;
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

  function updateWatchLaterBtn() {
    if (!els.watchLaterBtn) return;
    let list = [];
    try {
      list = JSON.parse(localStorage.getItem('watchLater')) || [];
    } catch (e) {}
    
    const inList = list.some(item => String(item.id) === String(id) && item.mediaType === type);
    if (inList) {
      els.watchLaterLabel.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> In Watch Later';
      els.watchLaterBtn.classList.add('active');
    } else {
      els.watchLaterLabel.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Watch Later';
      els.watchLaterBtn.classList.remove('active');
    }
  }

  // ─── Rating ───
  async function handleRating(score) {
    if (!state.details) return;

    let ratings = {};
    try {
      ratings = JSON.parse(localStorage.getItem('mediaRatings')) || {};
    } catch(e) {}

    const key = `${type}_${id}`;
    const currentScore = ratings[key];

    try {
      if (currentScore === score) {
        // User clicked the same rating, so remove it
        delete ratings[key];
        localStorage.setItem('mediaRatings', JSON.stringify(ratings));
        updateRateBtns();
        showToast("Rating removed");
        if (TMDB.deleteRating) {
          await TMDB.deleteRating(type, id);
        }
      } else {
        // User applied a new rating
        ratings[key] = score;
        localStorage.setItem('mediaRatings', JSON.stringify(ratings));
        updateRateBtns();
        showToast(score === 10 ? "Rated Thumbs Up" : "Rated Thumbs Down");
        if (TMDB.rateMedia) {
          await TMDB.rateMedia(type, id, score);
        }
      }
    } catch (err) {
      console.error("Failed to sync rating with TMDB:", err);
      // Even if TMDB sync fails, we already updated UI and local state for instant feedback.
    }
  }

  function updateRateBtns() {
    if (!els.thumbsUpBtn || !els.thumbsDownBtn) return;
    let ratings = {};
    try {
      ratings = JSON.parse(localStorage.getItem('mediaRatings')) || {};
    } catch(e) {}

    const key = `${type}_${id}`;
    const score = ratings[key];

    if (score === 10) {
      els.thumbsUpBtn.classList.add('active');
      els.thumbsUpBtn.style.color = 'var(--brand)';
      els.thumbsUpBtn.style.borderColor = 'var(--brand)';
      els.thumbsDownBtn.classList.remove('active');
      els.thumbsDownBtn.style.color = '';
      els.thumbsDownBtn.style.borderColor = '';
    } else if (score === 1 || score <= 2) {
      els.thumbsDownBtn.classList.add('active');
      els.thumbsDownBtn.style.color = 'var(--brand)';
      els.thumbsDownBtn.style.borderColor = 'var(--brand)';
      els.thumbsUpBtn.classList.remove('active');
      els.thumbsUpBtn.style.color = '';
      els.thumbsUpBtn.style.borderColor = '';
    } else {
      els.thumbsUpBtn.classList.remove('active');
      els.thumbsUpBtn.style.color = '';
      els.thumbsUpBtn.style.borderColor = '';
      els.thumbsDownBtn.classList.remove('active');
      els.thumbsDownBtn.style.color = '';
      els.thumbsDownBtn.style.borderColor = '';
    }
  }
})();
