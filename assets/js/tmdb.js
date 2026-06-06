/**
 * TMDB API Module
 * Handles all direct API calls to TMDB
 */
const TMDB = (() => {
  "use strict";

  const config = window.TMDB_CONFIG || {};
  const API_KEY = config.API_KEY || '';
  const BASE_URL = config.BASE_URL || 'https://api.themoviedb.org/3';
  const LANGUAGE = config.LANGUAGE || 'en-US';
  const WATCH_REGION = config.WATCH_REGION || 'PH';

  /**
   * Make a GET request to TMDB API
   */
  async function get(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    if (API_KEY) url.searchParams.set('api_key', API_KEY);
    url.searchParams.set('language', LANGUAGE);

    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
    const cacheKey = `tmdb_cache_${url.toString()}`;
    const cached = localStorage.getItem(cacheKey);
    
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_EXPIRY) {
          return parsed.data;
        } else {
          localStorage.removeItem(cacheKey);
        }
      } catch (e) {
        localStorage.removeItem(cacheKey);
      }
    }

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.status_message || `TMDB API error: ${response.status}`);
    }

    const data = await response.json();
    try {
      // Occasional cleanup of expired cache to free space
      if (Math.random() < 0.1) {
         for (let i = localStorage.length - 1; i >= 0; i--) {
           const key = localStorage.key(i);
           if (key && key.startsWith('tmdb_cache_')) {
             try {
               const item = JSON.parse(localStorage.getItem(key));
               if (Date.now() - item.timestamp >= CACHE_EXPIRY) {
                 localStorage.removeItem(key);
               }
             } catch(e) {}
           }
         }
      }

      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) {
      // If storage is full, aggressively clear all TMDB cache
      for (let i = localStorage.length - 1; i >= 0; i--) {
         const key = localStorage.key(i);
         if (key && key.startsWith('tmdb_cache_')) {
             localStorage.removeItem(key);
         }
      }
    }
    return data;
  }

  /**
   * Make a POST request to TMDB API
   */
  async function post(path, body = {}, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    if (API_KEY) url.searchParams.set('api_key', API_KEY);
    
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.status_message || `TMDB API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Make a DELETE request to TMDB API
   */
  async function deleteReq(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    if (API_KEY) url.searchParams.set('api_key', API_KEY);
    
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.status_message || `TMDB API error: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Get trending items
   */
  async function getTrending(mediaType = 'all', timeWindow = 'week') {
    return get(`/trending/${mediaType}/${timeWindow}`);
  }

  /**
   * Get top rated movies
   */
  async function getTopRatedMovies(page = 1) {
    return get('/movie/top_rated', { page });
  }

  /**
   * Get top rated TV shows
   */
  async function getTopRatedTV(page = 1) {
    return get('/tv/top_rated', { page });
  }

  /**
   * Discover movies by genre
   */
  async function discoverMovies(genreId, page = 1, sortBy = 'popularity.desc') {
    const today = new Date().toISOString().split('T')[0];
    return get('/discover/movie', {
      with_genres: genreId,
      sort_by: sortBy,
      include_adult: false,
      'primary_release_date.lte': today,
      page
    });
  }

  /**
   * Discover TV shows by genre
   */
  async function discoverTV(genreId, page = 1, sortBy = 'popularity.desc') {
    const today = new Date().toISOString().split('T')[0];
    return get('/discover/tv', {
      with_genres: genreId,
      sort_by: sortBy,
      include_adult: false,
      'first_air_date.lte': today,
      page
    });
  }

  /**
   * Discover media by watch provider
   */
  async function discoverByProvider(mediaType, providerId, page = 1) {
    const today = new Date().toISOString().split('T')[0];
    const dateParam = mediaType === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte';
    return get(`/discover/${mediaType}`, {
      with_watch_providers: providerId,
      watch_region: WATCH_REGION,
      sort_by: 'popularity.desc',
      include_adult: false,
      [dateParam]: today,
      page
    });
  }

  /**
   * Discover anime (Japanese animation)
   */
  async function discoverAnime(page = 1) {
    const [tvData, movieData] = await Promise.all([
      get('/discover/tv', {
        with_genres: 16,
        with_original_language: 'ja',
        sort_by: 'popularity.desc',
        include_adult: false,
        page
      }),
      get('/discover/movie', {
        with_genres: 16,
        with_original_language: 'ja',
        sort_by: 'popularity.desc',
        include_adult: false,
        page
      })
    ]);

    const tvResults = (tvData.results || []).map(item => ({ ...item, media_type: 'tv' }));
    const movieResults = (movieData.results || []).map(item => ({ ...item, media_type: 'movie' }));

    return {
      results: [...tvResults, ...movieResults]
    };
  }

  /**
   * Discover Filipino content (Tagalog original language)
   */
  async function discoverFilipino(sortBy = 'popularity.desc', page = 1, type = 'all') {
    const without_companies = '149142|173083'; // Vivamax & Vivamax Original Series
    const without_keywords = '325693|155477'; // erotica & softcore
    const today = new Date().toISOString().split('T')[0];

    let tvData = { results: [] };
    let movieData = { results: [] };

    if (type === 'all' || type === 'tv') {
      tvData = await get('/discover/tv', {
        with_original_language: 'tl',
        watch_region: WATCH_REGION,
        sort_by: sortBy,
        include_adult: false,
        without_companies,
        without_keywords,
        'first_air_date.lte': today,
        'vote_count.gte': sortBy.includes('date') ? 1 : 0,
        page
      });
    }

    if (type === 'all' || type === 'movie') {
      movieData = await get('/discover/movie', {
        with_original_language: 'tl',
        watch_region: WATCH_REGION,
        sort_by: sortBy,
        include_adult: false,
        without_companies,
        without_keywords,
        'primary_release_date.lte': today,
        'vote_count.gte': sortBy.includes('date') ? 1 : 0,
        page
      });
    }

    const tvResults = (tvData.results || []).map(item => ({ ...item, media_type: 'tv' }));
    const movieResults = (movieData.results || []).map(item => ({ ...item, media_type: 'movie' }));

    // Interleave or sort them by popularity/date depending on sortBy
    let combined = [...tvResults, ...movieResults];
    if (sortBy === 'popularity.desc') {
      combined.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    } else if (sortBy === 'primary_release_date.desc') {
      const getDate = (item) => {
        const d = item.release_date || item.first_air_date;
        return d ? new Date(d).getTime() : 0;
      };
      combined.sort((a, b) => getDate(b) - getDate(a));
    }

    return {
      results: combined
    };
  }

  /**
   * Get movie genres
   */
  async function getMovieGenres() {
    return get('/genre/movie/list');
  }

  /**
   * Get TV genres
   */
  async function getTVGenres() {
    return get('/genre/tv/list');
  }

  /**
   * Search multi (movies, TV, people)
   */
  async function searchMulti(query, page = 1) {
    return get('/search/multi', {
      query,
      include_adult: false,
      page
    });
  }

  /**
   * Search movies
   */
  async function searchMovies(query, page = 1) {
    return get('/search/movie', {
      query,
      include_adult: false,
      page
    });
  }

  /**
   * Search TV shows
   */
  async function searchTV(query, page = 1) {
    return get('/search/tv', {
      query,
      include_adult: false,
      page
    });
  }

  /**
   * Advanced Discovery wrapper
   */
  async function discoverAdvanced(type = 'movie', params = {}) {
    return get(`/discover/${type}`, params);
  }

  /**
   * Get movie details
   */
  async function getMovieDetails(movieId) {
    return get(`/movie/${movieId}`, {
      append_to_response: 'videos,reviews,external_ids,credits,recommendations,similar,images',
      include_image_language: 'en,null'
    });
  }

  /**
   * Get TV show details
   */
  async function getTVDetails(tvId) {
    return get(`/tv/${tvId}`, {
      append_to_response: 'videos,reviews,external_ids,credits,recommendations,similar,images',
      include_image_language: 'en,null'
    });
  }

  /**
   * Get TV season details
   */
  async function getTVSeasonDetails(tvId, seasonNumber) {
    return get(`/tv/${tvId}/season/${seasonNumber}`);
  }

  /**
   * Get movie watch providers
   */
  async function getMovieProviders(movieId) {
    return get(`/movie/${movieId}/watch/providers`);
  }

  /**
   * Get TV watch providers
   */
  async function getTVProviders(tvId) {
    return get(`/tv/${tvId}/watch/providers`);
  }

  /**
   * Get movie videos (trailers, teasers)
   */
  async function getMovieVideos(movieId) {
    return get(`/movie/${movieId}/videos`);
  }

  /**
   * Get TV videos
   */
  async function getTVVideos(tvId) {
    return get(`/tv/${tvId}/videos`);
  }

  /**
   * Look up MAL ID using Jikan API
   */
  async function lookupMalId(title) {
    if (!title) return 0;

    try {
      const normalize = (value) => String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const sourceTitle = normalize(title);
      const searchTitle = encodeURIComponent(title);
      const cacheKey = `jikan_cache_${searchTitle}`;
      const cached = localStorage.getItem(cacheKey);
      
      if (cached) {
         try {
           const parsed = JSON.parse(cached);
           if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
             return parsed.data;
           }
         } catch(e) {}
      }

      const response = await fetch(`https://api.jikan.moe/v4/anime?q=${searchTitle}&limit=5&sfw=true`);
      const data = await response.json();
      const results = data.data || [];

      let bestId = 0;
      let bestScore = -1;

      for (const anime of results) {
        if (!anime.mal_id) continue;

        const candidates = [
          anime.title,
          anime.title_english,
          anime.title_japanese,
          ...(Array.isArray(anime.title_synonyms) ? anime.title_synonyms : [])
        ].map(normalize).filter(Boolean);

        let score = 0;
        for (const candidate of candidates) {
          if (candidate === sourceTitle) {
            score = Math.max(score, 100);
          } else if (candidate.startsWith(sourceTitle) || sourceTitle.startsWith(candidate)) {
            score = Math.max(score, 80);
          } else if (candidate.includes(sourceTitle) || sourceTitle.includes(candidate)) {
            score = Math.max(score, 60);
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestId = anime.mal_id;
        }
      }

      if (bestId > 0) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: bestId }));
        } catch(e) {}
        return bestId;
      }

      for (const anime of results) {
        if (anime.mal_id) {
          return anime.mal_id;
        }
      }
    } catch (err) {
      console.error('MAL lookup failed:', err);
    }

    return 0;
  }

  /**
   * Manage TMDB Guest Sessions
   */
  async function getGuestSession() {
    let sessionId = localStorage.getItem('tmdb_guest_session_id');
    if (!sessionId) {
      const data = await get('/authentication/guest_session/new');
      sessionId = data.guest_session_id;
      localStorage.setItem('tmdb_guest_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Rate a movie or TV show
   */
  async function rateMedia(mediaType, mediaId, rating) {
    if (mediaType !== 'movie' && mediaType !== 'tv') return null;
    const sessionId = await getGuestSession();
    return post(`/${mediaType}/${mediaId}/rating`, { value: rating }, { guest_session_id: sessionId });
  }

  /**
   * Delete a rating for a movie or TV show
   */
  async function deleteRating(mediaType, mediaId) {
    if (mediaType !== 'movie' && mediaType !== 'tv') return null;
    const sessionId = await getGuestSession();
    return deleteReq(`/${mediaType}/${mediaId}/rating`, { guest_session_id: sessionId });
  }

  // Public API
  return {
    get,
    getTrending,
    getTopRatedMovies,
    getTopRatedTV,
    discoverMovies,
    discoverTV,
    discoverAnime,
    discoverByProvider,
    discoverAdvanced,
    discoverFilipino,
    getMovieGenres,
    getTVGenres,
    searchMulti,
    searchMovies,
    searchTV,
    getMovieDetails,
    getTVDetails,
    getTVSeasonDetails,
    getMovieProviders,
    getTVProviders,
    getMovieVideos,
    getTVVideos,
    lookupMalId,
    getGuestSession,
    rateMedia,
    deleteRating
  };
})();

// Export for use in other modules
window.TMDB = TMDB;
