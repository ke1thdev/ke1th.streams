/**
 * TMDB API Module
 * Handles all direct API calls to TMDB
 */
const TMDB = (() => {
  "use strict";

  const config = window.TMDB_CONFIG || {};
  const API_KEY = config.API_KEY;
  const BASE_URL = config.BASE_URL || 'https://api.themoviedb.org/3';
  const LANGUAGE = config.LANGUAGE || 'en-US';
  const WATCH_REGION = config.WATCH_REGION || 'US';

  /**
   * Make a GET request to TMDB API
   */
  async function get(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('api_key', API_KEY);
    url.searchParams.set('language', LANGUAGE);

    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const cacheKey = `tmdb_cache_${url.toString()}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        // Fallback to fetch on parse error
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
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      // In case quota is exceeded or something
    }
    return data;
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
    return get('/discover/movie', {
      with_genres: genreId,
      sort_by: sortBy,
      include_adult: false,
      page
    });
  }

  /**
   * Discover TV shows by genre
   */
  async function discoverTV(genreId, page = 1, sortBy = 'popularity.desc') {
    return get('/discover/tv', {
      with_genres: genreId,
      sort_by: sortBy,
      include_adult: false,
      page
    });
  }

  /**
   * Discover anime (Japanese animation)
   */
  async function discoverAnime(page = 1) {
    return get('/discover/tv', {
      with_genres: 16,
      with_original_language: 'ja',
      sort_by: 'popularity.desc',
      include_adult: false,
      page
    });
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
      const searchTitle = encodeURIComponent(title);
      const response = await fetch(`https://api.jikan.moe/v4/anime?q=${searchTitle}&limit=5&sfw=true`);
      const data = await response.json();
      const results = data.data || [];

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

  // Public API
  return {
    get,
    getTrending,
    getTopRatedMovies,
    getTopRatedTV,
    discoverMovies,
    discoverTV,
    discoverAnime,
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
    lookupMalId
  };
})();

// Export for use in other modules
window.TMDB = TMDB;