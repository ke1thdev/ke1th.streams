"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("searchOverlay");
  const openBtns = document.querySelectorAll("#openSearchBtn, #openSearchBtnMobile");
  const closeBtn = document.getElementById("searchCloseBtn");
  const input = document.getElementById("searchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  const resultsEl = document.getElementById("searchResults");
  const filterBtns = document.querySelectorAll(".search-filter-option");
  const filterLabel = document.getElementById("searchFilterLabel");
  const filterToggle = document.getElementById("searchFilterToggle");
  const filterMenu = document.getElementById("searchFilterMenu");

  if (!overlay || !input) return;

  let searchFilter = "all";
  let searchDebounce = null;
  const FALLBACK_POSTER = "/assets/imgs/poster-placeholder.png"; // verify path if needed

  const esc = (str) => {
    const div = document.createElement("div");
    div.innerText = str || "";
    return div.innerHTML;
  };

  const getHistory = () => {
    try { return JSON.parse(localStorage.getItem("search_history")) || []; }
    catch { return []; }
  };

  const saveHistory = (q) => {
    let hist = getHistory();
    hist = hist.filter(x => x.toLowerCase() !== q.toLowerCase());
    hist.unshift(q);
    if (hist.length > 10) hist.pop();
    localStorage.setItem("search_history", JSON.stringify(hist));
  };

  const clearHistory = () => {
    localStorage.removeItem("search_history");
    renderHistory();
  };

  const renderHistory = () => {
    const hist = getHistory();
    if (!hist.length) {
      resultsEl.innerHTML = `<div style="padding: 40px 20px; color: #888; text-align: center; font-size: 0.95rem;">Type to search for movies, TV shows, cast & crew,<br>or enter an exact IMDB / TMDB ID.</div>`;
      return;
    }
    resultsEl.innerHTML = `
      <div class="search-recent-header" style="display:flex; justify-content:space-between; padding: 10px 16px; align-items:center;">
        <span style="color:var(--text-bright); font-weight:600; font-size:1rem;">Recent Searches</span>
        <button id="clearRecentBtn" style="background:none; border:none; color:var(--brand); cursor:pointer; font-size:0.85rem; font-weight:600;">Clear All</button>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px; padding:0 12px;">
        ${hist.map(q => `
          <div class="search-recent-item" data-query="${esc(q)}" style="display:flex; align-items:center; gap:12px; padding:12px; background:rgba(255,255,255,0.05); border-radius:8px; cursor:pointer; transition:background 0.2s;">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#888" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span style="color:#ddd; font-weight:500;">${esc(q)}</span>
          </div>
        `).join("")}
      </div>
    `;
    const clr = resultsEl.querySelector("#clearRecentBtn");
    if (clr) clr.addEventListener("click", clearHistory);
  };

  const openSearch = () => {
    overlay.classList.remove("hidden");
    input.value = "";
    if (clearBtn) clearBtn.classList.add("hidden");
    renderHistory();
    requestAnimationFrame(() => input.focus());
  };

  const closeSearch = () => {
    overlay.classList.add("hidden");
    input.value = "";
    resultsEl.innerHTML = "";
  };

  openBtns.forEach(btn => btn.addEventListener("click", openSearch));
  if (closeBtn) closeBtn.addEventListener("click", closeSearch);
  overlay.addEventListener("click", (e) => {
    if (!e.target.closest(".search-container")) closeSearch();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeSearch();
  });

  if (filterToggle && filterMenu) {
    filterToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = filterMenu.style.display === "flex";
      filterMenu.style.display = isVisible ? "none" : "flex";
      const chev = filterToggle.querySelector("svg");
      if (chev) chev.style.transform = isVisible ? "rotate(0deg)" : "rotate(180deg)";
    });
    document.addEventListener("click", () => {
      filterMenu.style.display = "none";
      const chev = filterToggle.querySelector("svg");
      if (chev) chev.style.transform = "rotate(0deg)";
    });
    filterBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        filterBtns.forEach(b => { b.classList.remove("active"); b.style.color = "#888"; });
        btn.classList.add("active");
        btn.style.color = "#fff";
        filterLabel.textContent = btn.textContent;
        searchFilter = btn.dataset.filter || "all";
        filterMenu.style.display = "none";
        const chev = filterToggle.querySelector("svg");
        if (chev) chev.style.transform = "rotate(0deg)";
        const q = input.value.trim();
        if (q.length >= 2) doSearch(q);
      });
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      clearBtn.classList.add("hidden");
      renderHistory();
      input.focus();
    });
  }

  input.addEventListener("input", () => {
    const q = input.value.trim();
    if (clearBtn) {
      if (q.length > 0) clearBtn.classList.remove("hidden");
      else clearBtn.classList.add("hidden");
    }
    clearTimeout(searchDebounce);
    if (q.length < 2) {
      renderHistory();
      return;
    }
    searchDebounce = setTimeout(() => doSearch(q), 300);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (q.length >= 2) saveHistory(q);
    }
  });

  resultsEl.addEventListener("click", (e) => {
    const recent = e.target.closest(".search-recent-item");
    if (recent) {
      input.value = recent.dataset.query;
      doSearch(recent.dataset.query);
      return;
    }

    const card = e.target.closest(".search-item");
    if (card) {
      const id = card.dataset.id;
      const type = card.dataset.type;
      if (id && type) {
        saveHistory(input.value.trim());
        const base = window.APP_CONFIG?.APP_BASE || "";
        window.location.href = `${base}/media.html?type=${type}&id=${id}`;
      }
    }
  });

  async function doSearch(query) {
    try {
      let results = [];
      const TMDB_IMG = "https://image.tmdb.org/t/p/w200";

      resultsEl.innerHTML = `<div class="spinner" style="margin: 40px auto;"></div>`;

      // Intelligent Search: IMDB or TMDB ID
      if (/^tt\d{7,8}$/.test(query)) {
        const data = await TMDB.get(`/find/${query}`, { external_source: 'imdb_id' });
        if (data.movie_results?.length) results.push(...data.movie_results.map(m => ({ ...m, media_type: 'movie' })));
        if (data.tv_results?.length) results.push(...data.tv_results.map(m => ({ ...m, media_type: 'tv' })));
      } else if (/^\d{3,}$/.test(query)) {
        try {
          const [m, t] = await Promise.allSettled([
            TMDB.get(`/movie/${query}`),
            TMDB.get(`/tv/${query}`)
          ]);
          if (m.status === 'fulfilled' && m.value && !m.value.success) {
            m.value.media_type = 'movie';
            results.push(m.value);
          }
          if (t.status === 'fulfilled' && t.value && !t.value.success) {
            t.value.media_type = 'tv';
            results.push(t.value);
          }
        } catch (e) { }
      }

      // If no exact ID match or it's just a text query
      if (results.length === 0 && !/^tt\d{7,8}$/.test(query)) {
        let endpoint = '/search/multi';
        if (searchFilter === 'movie') endpoint = '/search/movie';
        if (searchFilter === 'tv') endpoint = '/search/tv';
        if (searchFilter === 'person') endpoint = '/search/person';

        const data = await TMDB.get(endpoint, { query, page: 1, include_adult: false });
        (data.results || []).forEach(item => {
          const type = item.media_type || (searchFilter === 'movie' ? 'movie' : (searchFilter === 'tv' ? 'tv' : null));
          if ((item.media_type === 'person' || searchFilter === 'person') && item.known_for) {
            results.push(...item.known_for.filter(kf => (kf.media_type === 'movie' || kf.media_type === 'tv') && (kf.poster_path || kf.backdrop_path)));
          } else if ((type === 'movie' || type === 'tv') && (item.poster_path || item.backdrop_path)) {
            item.media_type = type;
            results.push(item);
          }
        });
      }

      // Deduplicate
      const seen = new Set();
      results = results.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, 20);

      if (!results.length) {
        resultsEl.innerHTML = `<p class="search-empty" style="padding: 20px; color: #888; text-align: center;">No results for "${esc(query)}"</p>`;
        return;
      }

      resultsEl.innerHTML = results.map(item => {
        const title = item.title || item.name || "Untitled";
        const year = (item.release_date || item.first_air_date || "").slice(0, 4);
        const type = item.media_type === "tv" ? "TV Show" : "Movie";
        const poster = item.poster_path ? `${TMDB_IMG}${item.poster_path}` : FALLBACK_POSTER;
        const rating = Number(item.vote_average || 0).toFixed(1);
        const overview = item.overview || "No description available.";

        return `
          <div class="search-item" data-id="${item.id}" data-type="${item.media_type}" data-title="${esc(title)}">
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
            </div>
          </div>
        `;
      }).join("");
    } catch (err) {
      console.error(err);
      resultsEl.innerHTML = `<p class="search-error" style="padding: 20px; color: #e50914; text-align: center;">Search failed. Try again.</p>`;
    }
  }
});
