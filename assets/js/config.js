// TMDB API Configuration
// Note: TMDB API keys are designed for client-side use and are rate-limited
const TMDB_CONFIG = {
  API_KEY: '7c7c0cc999abb33b3e1abbadd57d53ee',
  BASE_URL: 'https://api.themoviedb.org/3',
  IMAGE_BASE: 'https://image.tmdb.org/t/p/w500',
  BACKDROP_BASE: 'https://image.tmdb.org/t/p/original',
  LANGUAGE: 'en-US',
  WATCH_REGION: 'US'
};

// Export for use in other modules
window.TMDB_CONFIG = TMDB_CONFIG;