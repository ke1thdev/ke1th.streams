const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/live-recovery.js'), 'utf8');

async function flush() {
  for (let count = 0; count < 5; count++) await Promise.resolve();
}

function harness(config = {}) {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  let clock = 0;
  let serial = 0;
  let key = 'channel-a';
  let reads = 0;
  const timers = new Map();
  const media = { time: 0, paused: false, visible: true, online: true };
  const reloads = [];
  const statuses = [];
  const exhausted = [];
  const controller = context.window.LivePlaybackRecovery.create({
    now: () => clock,
    schedule(callback, delay) {
      const id = ++serial;
      timers.set(id, { id, at: clock + delay, callback });
      return id;
    },
    cancel: id => timers.delete(id),
    isCurrent: candidate => candidate === key,
    snapshot() { reads++; return { ...media }; },
    reload(candidate) {
      return new Promise((resolve, reject) => reloads.push({ key: candidate, at: clock, resolve, reject }));
    },
    onStatus: (state, message) => statuses.push({ key, state, message, at: clock }),
    onExhausted: candidate => exhausted.push({ key: candidate, at: clock }),
    ...config
  });

  function nextTimer() {
    return [...timers.values()].sort((a, b) => a.at - b.at || a.id - b.id)[0];
  }
  function moveTo(time, progress) {
    if (progress && !media.paused && media.visible && media.online) media.time += (time - clock) / 1000;
    clock = time;
  }
  function step(progress = false) {
    const next = nextTimer();
    if (!next) return false;
    moveTo(next.at, progress);
    timers.delete(next.id);
    next.callback();
    return true;
  }
  async function advance(milliseconds, progress = false) {
    const target = clock + milliseconds;
    let count = 0;
    while (nextTimer()?.at <= target) {
      assert.ok(count++ < 10000, 'the controller must not spin in an immediate timer loop');
      step(progress);
      await flush();
    }
    moveTo(target, progress);
    await flush();
  }

  return {
    controller, media, reloads, statuses, exhausted, timers, advance, step,
    get now() { return clock; },
    get reads() { return reads; },
    get key() { return key; },
    set key(value) { key = value; },
    start(candidate = key) { key = candidate; controller.start(candidate); },
    async rejectLast() { reloads.at(-1).reject(new Error('stream request failed')); await flush(); },
    async resolveLast() { reloads.at(-1).resolve(); await flush(); }
  };
}

test('healthy playback and a short buffer do not reload the stream', async () => {
  const h = harness();
  h.start();
  await h.advance(20000, true);
  await h.advance(10000);
  assert.equal(h.reloads.length, 0);
  await h.advance(60000, true);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.exhausted.length, 0);
  assert.equal(h.statuses.at(-1).state, 'live');
});

test('sustained no-progress playback reloads the current channel once', async () => {
  const h = harness();
  h.start();
  await h.advance(20000, true);
  await h.advance(16000);
  assert.equal(h.reloads.length, 1);
  assert.equal(h.reloads[0].key, 'channel-a');
  assert.match(h.statuses.at(-1).message, /1\/3/);
  assert.equal(h.controller.loading(), true);
});

test('hung startup is watched even when the load promise never settles', async () => {
  const h = harness();
  h.start();
  await h.advance(24000);
  assert.equal(h.reloads.length, 0);
  await h.advance(2000);
  assert.equal(h.reloads.length, 1);
  await h.advance(26000);
  assert.equal(h.reloads.length, 2);
});

test('a play request without media progress keeps the startup deadline', async () => {
  const h = harness();
  h.start();
  h.controller.intent(true);
  await h.advance(24000);
  assert.equal(h.reloads.length, 0);
  await h.advance(2000);
  assert.equal(h.reloads.length, 1);
});

test('persistent failure uses at most three reloads and exhausts once', async () => {
  const h = harness();
  h.start();
  assert.equal(h.controller.failed(), true);
  await h.advance(180000);
  assert.equal(h.reloads.length, 3);
  assert.equal(h.exhausted.length, 1);
  assert.equal(h.exhausted[0].key, 'channel-a');
  assert.equal(h.controller.wantsPlay(), false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.controller.failed(), false);
  h.controller.wake();
  await h.advance(180000);
  assert.equal(h.reloads.length, 3);
  assert.equal(h.exhausted.length, 1);
});

test('a brief recovery does not reset the retry budget; sustained playback does', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  await h.advance(1000);
  await h.resolveLast();
  await h.advance(10000, true);
  h.controller.failed();
  await h.advance(4000);
  assert.equal(h.reloads.length, 2);
  assert.match(h.statuses.at(-1).message, /2\/3/);
  await h.resolveLast();
  // Finish on a sampling tick so the next failure sees no residual progress.
  await h.advance(37000, true);
  h.controller.failed();
  await h.advance(1000);
  assert.equal(h.reloads.length, 3);
  assert.match(h.statuses.at(-1).message, /1\/3/);
});

test('interrupted progress does not accumulate into a stable-playback budget reset', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  await h.advance(1000);
  await h.resolveLast();
  for (let count = 0; count < 4; count++) {
    await h.advance(10000, true);
    await h.advance(6000);
  }
  h.controller.failed();
  await h.advance(4000);
  assert.equal(h.reloads.length, 2);
  assert.match(h.statuses.at(-1).message, /2\/3/);
});

for (const reason of ['manual pause', 'autoplay blocked']) {
  test(`${reason} stops recovery and is not resumed by wake`, async () => {
    const h = harness();
    h.start();
    await h.advance(10000, true);
    h.media.paused = true;
    h.controller.intent(false);
    assert.equal(h.controller.failed(), false);
    h.controller.wake();
    await h.advance(180000);
    assert.equal(h.reloads.length, 0);
    assert.equal(h.controller.wantsPlay(), false);
    assert.equal(h.timers.size, 0);
  });
}

test('closing before a scheduled retry cancels it', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  h.controller.stop();
  await h.advance(180000);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.timers.size, 0);
});

test('closing between a timer and its queued reload cancels the reload', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  h.step();
  h.controller.stop();
  await flush();
  assert.equal(h.reloads.length, 0);
  assert.equal(h.timers.size, 0);
});

test('switching to a non-native source invalidates pending native recovery', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  h.key = 'radio-or-youtube';
  await h.advance(180000);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.timers.size, 0);
});

test('a late rejected reload cannot change the next channel session', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  await h.advance(1000);
  const oldReload = h.reloads[0];
  h.start('channel-b');
  await h.advance(6000, true);
  const count = h.statuses.length;
  oldReload.reject(new Error('old channel timed out'));
  await flush();
  assert.equal(h.statuses.length, count);
  assert.equal(h.reloads.length, 1);
  assert.equal(h.controller.wantsPlay(), true);
  assert.equal(h.statuses.at(-1).key, 'channel-b');
  assert.equal(h.statuses.at(-1).state, 'live');
});

test('a late rejected reload after pause cannot restart recovery', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  await h.advance(1000);
  h.media.paused = true;
  h.controller.intent(false);
  const count = h.statuses.length;
  await h.rejectLast();
  await h.advance(180000);
  assert.equal(h.statuses.length, count);
  assert.equal(h.reloads.length, 1);
  assert.equal(h.timers.size, 0);
});

test('a late failure from an older reload cannot poison a newer attempt', async () => {
  const h = harness();
  h.start();
  h.controller.failed();
  await h.advance(1000);
  const older = h.reloads[0];
  await h.advance(26000);
  assert.equal(h.reloads.length, 2);
  const count = h.statuses.length;
  older.reject(new Error('older manifest request finally failed'));
  await flush();
  assert.equal(h.statuses.length, count);
  await h.resolveLast();
  await h.advance(10000, true);
  assert.equal(h.reloads.length, 2);
  assert.equal(h.statuses.at(-1).state, 'live');
});

for (const condition of ['online', 'visible']) {
  test(`${condition}=false suspends polling without using retry attempts`, async () => {
    const h = harness();
    h.start();
    await h.advance(20000, true);
    h.media[condition] = false;
    h.controller.suspend();
    const reads = h.reads;
    await h.advance(180000);
    assert.equal(h.reads, reads);
    assert.equal(h.reloads.length, 0);
    assert.equal(h.timers.size, 0);
    h.controller.wake();
    assert.equal(h.timers.size, 0);
    h.media[condition] = true;
    h.controller.wake();
    await h.advance(14000);
    assert.equal(h.reloads.length, 0);
    await h.advance(2000);
    assert.equal(h.reloads.length, 1);
    assert.match(h.statuses.at(-1).message, /1\/3/);
  });
}

test('a hidden state discovered by the watchdog stops further polling', async () => {
  const h = harness();
  h.start();
  h.media.visible = false;
  await h.advance(180000);
  assert.equal(h.reads, 1);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.timers.size, 0);
});

test('wake grants a fresh stall grace period even after an earlier failure', async () => {
  const h = harness();
  h.start();
  await h.advance(20000, true);
  h.controller.failed();
  h.media.online = false;
  h.controller.suspend();
  await h.advance(180000);
  h.media.online = true;
  h.controller.wake();
  await h.advance(14000);
  assert.equal(h.reloads.length, 0, 'pre-suspension errors must not bypass wake grace');
  await h.advance(2000);
  assert.equal(h.reloads.length, 1);
});

test('an explicit grace period clears an earlier failure deadline', async () => {
  const h = harness();
  h.start();
  await h.advance(20000, true);
  h.controller.failed();
  h.controller.grace();
  await h.advance(14000);
  assert.equal(h.reloads.length, 0);
  await h.advance(2000);
  assert.equal(h.reloads.length, 1);
});
