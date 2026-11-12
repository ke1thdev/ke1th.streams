/* Shared playback history. Keep the original storage key and episode IDs. */
(() => {
  'use strict';

  const storageKey = 'watchProgress';
  const completionThreshold = 95;
  const statuses = ['started', 'watching', 'finished', 'up-next'];
  let memory = {};
  let lastWrite = 0;
  let storageUnavailable = false;
  let lastRaw;

  function identify({ type, id, season, episode }) {
    if (!['movie', 'tv'].includes(type) || !/^\d+$/.test(id) || Number(id) < 1) return null;
    const media = { type, id: String(id) };
    if (type === 'tv') {
      if (!/^\d+$/.test(season) || !/^\d+$/.test(episode) || Number(episode) < 1) return null;
      media.season = Number(season);
      media.episode = Number(episode);
    }
    const titleKey = type + '_' + media.id;
    const key = type === 'tv' ? titleKey + '_' + media.season + '_' + media.episode : titleKey;
    return { ...media, key, titleKey };
  }

  function read() {
    if (storageUnavailable) return { ...memory };
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === lastRaw) return memory;
      const value = raw ? JSON.parse(raw) : {};
      lastRaw = raw;
      memory = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return memory;
    } catch {
      return { ...memory };
    }
  }

  function number(value) {
    const result = Number(value);
    return Number.isFinite(result) ? Math.max(0, result) : 0;
  }

  function normalize(data, media) {
    if (!data || typeof data !== 'object' || !media) return null;
    const currentTime = number(data.currentTime);
    const duration = number(data.duration);
    const progress = Math.min(100, number(data.progress ?? (duration ? currentTime / duration * 100 : 0)));
    const status = statuses.includes(data.status)
      ? data.status
      : progress >= completionThreshold ? 'finished' : currentTime > 0 || progress > 0 ? 'watching' : 'started';
    return {
      ...media, currentTime, duration, progress, status, lastUpdated: number(data.lastUpdated),
      dismissed: data.dismissed === true,
      isAnime: data.isAnime === true,
      malId: number(data.malId) || null
    };
  }

  function records(data) {
    return Object.entries(data).map(([key, entry]) => {
      const [type, id, season, episode, extra] = key.split('_');
      const media = identify({ type, id, season, episode });
      return !extra && media?.key === key ? normalize(entry, media) : null;
    }).filter(Boolean).sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  function persist(data) {
    memory = data;
    try {
      const raw = JSON.stringify(data);
      localStorage.setItem(storageKey, raw);
      lastRaw = raw;
    } catch {
      storageUnavailable = true;
    }
  }

  function write(data, media, entry, input, previous) {
    lastWrite = Math.max(Date.now(), lastWrite + 1);
    entry.lastUpdated = lastWrite;
    entry.isAnime = media.type === 'tv' && (input.isAnime === true || previous?.isAnime === true);
    entry.malId = entry.isAnime ? number(input.malId) || previous?.malId || null : null;
    data[media.key] = entry;
    persist(data);
    return normalize(entry, media);
  }

  function activate(input, queued) {
    const media = identify(input);
    if (!media) return null;
    const data = read();
    const previous = normalize(data[media.key], media);
    if (previous?.status === 'finished') return previous;

    const status = previous?.status === 'watching' ? 'watching' : queued ? 'up-next' : 'started';
    return write(data, media, {
      currentTime: previous?.currentTime || 0,
      duration: previous?.duration || 0,
      progress: previous?.progress || 0,
      status
    }, input, previous);
  }

  function saveProgress(input, details, finished) {
    const media = identify(input);
    if (!media) return null;
    const data = read();
    const previous = normalize(data[media.key], media);
    if (previous?.status === 'finished') return previous;

    const duration = number(details.duration) || previous?.duration || 0;
    const currentTime = details.currentTime == null ? previous?.currentTime || 0 : number(details.currentTime);
    const progress = finished ? 100 : Math.min(100, details.progress == null
      ? duration ? currentTime / duration * 100 : previous?.progress || 0
      : number(details.progress));
    const status = progress >= completionThreshold ? 'finished' : currentTime > 0 || progress > 0 ? 'watching' : 'started';
    if (status === 'started' && previous) return previous;
    return write(data, media, { currentTime, duration, progress, status }, input, previous);
  }

  window.WatchHistory = {
    get(input) {
      const media = identify(input);
      return media ? normalize(read()[media.key], media) : null;
    },
    start: input => activate(input, false),
    queue: input => activate(input, true),
    update: (input, details = {}) => saveProgress(input, details, false),
    finish: (input, details = {}) => saveProgress(input, details, true),
    getResume(type, id) {
      const latest = records(read()).find(entry => entry.type === type && entry.id === String(id));
      return latest && latest.status !== 'finished' ? latest : null;
    },
    getContinueWatching() {
      const latestByTitle = new Map();
      for (const entry of records(read())) {
        if (!latestByTitle.has(entry.titleKey)) latestByTitle.set(entry.titleKey, entry);
      }
      return [...latestByTitle.values()].filter(entry => !entry.dismissed && entry.status !== 'finished');
    },
    dismiss(key) {
      const data = read();
      if (!Object.prototype.hasOwnProperty.call(data, key) || !data[key]) return;
      data[key] = { ...data[key], dismissed: true };
      persist(data);
    }
  };
})();
