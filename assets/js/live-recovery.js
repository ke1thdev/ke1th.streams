(() => {
  'use strict';

  // A fresh live playlist can recover an expired/stuck session after Shaka's
  // normal segment retries. The budget belongs to the tune, not to each reload.
  function create(options) {
    const now = options.now || Date.now;
    const schedule = options.schedule || setTimeout;
    const cancel = options.cancel || clearTimeout;
    const startupMs = options.startupMs || 25000;
    const stallMs = options.stallMs || 15000;
    const stableMs = options.stableMs || 30000;
    const maxAttempts = options.maxAttempts || 3;
    let state = null;
    let timer = null;

    const current = () => state && options.isCurrent(state.key);
    function clearTimer() {
      if (timer !== null) cancel(timer);
      timer = null;
    }
    function stop() {
      clearTimer();
      state = null;
    }
    function arm(delay = 2000) {
      clearTimer();
      if (current() && state.wantsPlay && !state.exhausted) timer = schedule(check, delay);
    }
    function reconnect() {
      if (!current() || !state.wantsPlay) return;
      if (state.attempts >= maxAttempts) {
        const key = state.key;
        state.exhausted = true;
        clearTimer();
        options.onExhausted(key);
        return;
      }
      const session = state;
      const generation = ++session.generation;
      session.attempts++;
      session.loading = true;
      session.failedAt = null;
      session.lastAt = now();
      session.lastTime = null;
      session.stableAt = null;
      options.onStatus('loading', `Reconnecting… ${session.attempts}/${maxAttempts}`);
      // Keep watching startup progress even if load() itself never settles.
      Promise.resolve().then(() => {
        if (state === session && current() && session.wantsPlay) return options.reload(session.key);
      }).catch(() => {
        if (state === session && session.generation === generation && current()) failed();
      });
      arm();
    }
    function check() {
      timer = null;
      if (!current()) return stop();
      const snapshot = options.snapshot();
      if (snapshot.visible === false || snapshot.online === false) {
        if (state.suspendedAt === null) state.suspendedAt = now();
        if (snapshot.online === false && state.wantsPlay) options.onStatus('loading', 'Waiting for connection…');
        return; // online/visibility events wake us; no background polling.
      }
      if (!state.wantsPlay || state.exhausted) return;
      const time = now();
      if (Number.isFinite(snapshot.time) && state.lastTime !== null &&
          Math.abs(snapshot.time - state.lastTime) > 0.05 && !snapshot.paused) {
        state.loading = false;
        state.failedAt = null;
        state.lastAt = time;
        if (state.stableAt === null) state.stableAt = time;
        if (time - state.stableAt >= stableMs) state.attempts = 0;
        options.onStatus('live', 'Live');
      } else if (time - state.lastAt > 4000) {
        state.stableAt = null;
      }
      state.lastTime = snapshot.time;
      const failed = state.failedAt !== null && time - state.failedAt >= 1000 * (2 ** state.attempts);
      if (failed || time - state.lastAt >= (state.loading ? startupMs : stallMs)) reconnect();
      else arm();
    }
    function start(key) {
      stop();
      state = { key, attempts: 0, generation: 0, wantsPlay: true, loading: true,
        lastAt: now(), lastTime: null, stableAt: null, failedAt: null,
        suspendedAt: null, exhausted: false };
      arm();
    }
    function intent(wantsPlay) {
      if (!current() || state.exhausted) return;
      state.wantsPlay = wantsPlay;
      state.lastAt = now();
      state.lastTime = options.snapshot().time;
      state.stableAt = null;
      if (wantsPlay) {
        arm();
      } else clearTimer();
    }
    function failed() {
      if (!current() || !state.wantsPlay || state.exhausted) return false;
      if (state.failedAt === null) state.failedAt = now();
      state.stableAt = null;
      options.onStatus('loading', 'Reconnecting…');
      arm(1000);
      return true;
    }
    function suspend() {
      if (!current()) return;
      if (state.suspendedAt === null) state.suspendedAt = now();
      clearTimer();
      if (options.snapshot().online === false && state.wantsPlay) options.onStatus('loading', 'Waiting for connection…');
    }
    function wake() {
      if (!current() || !state.wantsPlay || state.exhausted) return;
      const snapshot = options.snapshot();
      if (snapshot.visible === false || snapshot.online === false) return;
      // Background timer throttling is not evidence of a stall. Give the
      // current stream a chance to advance before considering a fresh load.
      state.suspendedAt = null;
      state.lastAt = now();
      state.lastTime = snapshot.time;
      state.stableAt = null;
      state.failedAt = null;
      arm();
    }
    function grace() {
      if (current()) { state.lastAt = now(); state.stableAt = null; state.failedAt = null; }
    }
    return { start, stop, intent, failed, suspend, wake, grace,
      wantsPlay: () => Boolean(current() && state.wantsPlay && !state.exhausted),
      loading: () => Boolean(current() && state.loading) };
  }
  window.LivePlaybackRecovery = { create };
})();
