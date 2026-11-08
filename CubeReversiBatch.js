// Cube Reversi 2.0.19 — Bot vs Bot batch storage, stats, and panel.
// The bot engine stays in CubeReversiBot.js. This file does not search.
// APP_VERSION lives in version.js. This module re-exports it for saved games.

import { APP_VERSION } from './version.js?v=2.0.19';

export { APP_VERSION };
export const BATCH_FORMAT = 'cubereversi-batch';
export const BATCH_FORMAT_VERSION = 1;

const DB_NAME = 'CubeReversiBatch';
const DB_VERSION = 2;
const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Fixed amount of integer mixing. The score is mixes per second. The band is
// log2 of that score, so two runs on one machine stay together and a machine
// that is about twice as fast does not.
export function runCpuBenchmark() {
  const iterations = 2000000;
  const start = performance.now();
  let x = 0x12345678;
  for (let i = 0; i < iterations; i++) {
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
    x ^= x >>> 16;
  }
  const elapsedMs = Math.max(0.1, performance.now() - start);
  const score = Math.round((iterations / elapsedMs) * 1000);
  if (x === 0xffffffff) console.log(x);
  return {
    name: 'imul-mix-2e6',
    iterations,
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    score,
    band: Math.round(Math.log2(score))
  };
}

// One benchmark per page session. Animated games and a later batch share it,
// so the main thread does not re-run the mix loop at the start of every game.
let sessionDeviceProfile = null;

export function captureDeviceProfile() {
  if (!sessionDeviceProfile) {
    const cpuBenchmark = runCpuBenchmark();
    const memory = typeof navigator !== 'undefined' ? Number(navigator.deviceMemory) : NaN;
    sessionDeviceProfile = {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      hardwareConcurrency: typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : null,
      deviceMemory: Number.isFinite(memory) ? memory : null,
      cpuBenchmark
    };
  }
  return {
    ...sessionDeviceProfile,
    cpuBenchmark: { ...sessionDeviceProfile.cpuBenchmark }
  };
}

export function newId(prefix) {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}${rnd}`;
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('batches')) {
        const batches = db.createObjectStore('batches', { keyPath: 'id' });
        batches.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('games')) {
        const games = db.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('batchId', 'batchId');
        games.createIndex('finishedAt', 'finishedAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(name, mode, fn) {
  const db = await openDb();
  try {
    const tx = db.transaction(name, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
    const result = await fn(tx.objectStore(name));
    await done;
    return result;
  } finally {
    db.close();
  }
}

export async function saveBatch(batch) {
  return withStore('batches', 'readwrite', (store) => req(store.put(batch)));
}

export async function saveGame(game) {
  return withStore('games', 'readwrite', (store) => req(store.put(game)));
}

export async function listBatches() {
  const rows = await withStore('batches', 'readonly', (store) => req(store.getAll()));
  return rows.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

export async function listAllGames() {
  return withStore('games', 'readonly', (store) => req(store.getAll()));
}

export async function saveSetting(key, value) {
  return withStore('settings', 'readwrite', (store) => req(store.put(value, key)));
}

export async function loadSetting(key) {
  return withStore('settings', 'readonly', (store) => req(store.get(key)));
}

export async function deleteSetting(key) {
  return withStore('settings', 'readwrite', (store) => req(store.delete(key)));
}

export async function getBatchWithGames(id) {
  const db = await openDb();
  try {
    const batch = await new Promise((resolve, reject) => {
      const tx = db.transaction('batches', 'readonly');
      const request = tx.objectStore('batches').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (!batch) return null;
    const games = await new Promise((resolve, reject) => {
      const tx = db.transaction('games', 'readonly');
      const request = tx.objectStore('games').index('batchId').getAll(id);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    games.sort((a, b) => (a.index || 0) - (b.index || 0));
    return { batch, games };
  } finally {
    db.close();
  }
}

export async function deleteBatchById(id) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['batches', 'games'], 'readwrite');
      tx.objectStore('batches').delete(id);
      const index = tx.objectStore('games').index('batchId');
      const cursorReq = index.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Delete aborted'));
    });
  } finally {
    db.close();
  }
}

export async function markBatchExported(id) {
  const loaded = await getBatchWithGames(id);
  if (!loaded) return null;
  loaded.batch.exportedAt = new Date().toISOString();
  await saveBatch(loaded.batch);
  return loaded.batch;
}

export async function sweepStaleBatches() {
  const batches = await listBatches();
  const stale = batches.filter((batch) => batch.status === 'running');
  for (const batch of stale) {
    batch.status = 'stopped';
    batch.finishedAt = batch.finishedAt || new Date().toISOString();
    await saveBatch(batch);
  }
  return stale.length;
}

export function bookUsage(moves) {
  const book = { A: { used: false, moves: 0 }, B: { used: false, moves: 0 } };
  for (const move of moves || []) {
    if (move && move.src === 'BOOK' && book[move.bot]) {
      book[move.bot].moves++;
      book[move.bot].used = true;
    }
  }
  return book;
}

export function wilsonInterval(wins, n, z = 1.96) {
  const safeWins = Math.max(0, wins || 0);
  const safeN = Math.max(0, n || 0);
  if (!safeN) return { p: 0, low: 0, high: 0, n: 0, wins: 0, tooClose: false };
  const p = safeWins / safeN;
  const z2 = z * z;
  const denom = 1 + z2 / safeN;
  const centre = p + z2 / (2 * safeN);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * safeN)) / safeN);
  const low = Math.max(0, (centre - margin) / denom);
  const high = Math.min(1, (centre + margin) / denom);
  return {
    p, low, high, n: safeN, wins: safeWins,
    tooClose: low <= 0.5 && high >= 0.5
  };
}

function emptySide() {
  return { w: 0, l: 0, d: 0, n: 0 };
}

function emptyBehavior() {
  return { moves: 0, timeSum: 0, timeMax: 0, hits: 0, depthSum: 0, depthN: 0, passes: 0 };
}

function addResult(side, outcome) {
  side.n++;
  if (outcome === 'w') side.w++;
  else if (outcome === 'l') side.l++;
  else side.d++;
}

export function summarizeGames(games) {
  const bots = {
    A: { overall: emptySide(), black: emptySide(), white: emptySide(), behavior: emptyBehavior() },
    B: { overall: emptySide(), black: emptySide(), white: emptySide(), behavior: emptyBehavior() }
  };
  const margins = [];
  let early = 0;
  for (const game of games || []) {
    if (game.early) early++;
    if (Number.isFinite(game.margin)) margins.push(game.margin);
    for (const bot of ['A', 'B']) {
      const asBlack = game.first === bot;
      const outcome = game.winner == null ? 'd' : (game.winner === bot ? 'w' : 'l');
      addResult(bots[bot].overall, outcome);
      addResult(asBlack ? bots[bot].black : bots[bot].white, outcome);
      const behavior = bots[bot].behavior;
      for (const move of game.moves || []) {
        if (move.bot !== bot) continue;
        if (move.n === 'PASS' || move.src === 'PASS') {
          behavior.passes++;
          continue;
        }
        behavior.moves++;
        const ms = Number(move.ms) || 0;
        behavior.timeSum += ms;
        if (ms > behavior.timeMax) behavior.timeMax = ms;
        if (move.hit) behavior.hits++;
        if (move.src === 'SEARCH' || move.src === 'SOLVE') {
          behavior.depthSum += Number(move.depth) || 0;
          behavior.depthN++;
        }
      }
    }
  }
  for (const bot of ['A', 'B']) {
    const side = bots[bot];
    side.rate = wilsonInterval(side.overall.w, side.overall.n);
    side.blackRate = wilsonInterval(side.black.w, side.black.n);
    side.whiteRate = wilsonInterval(side.white.w, side.white.n);
    const behavior = side.behavior;
    behavior.avgMs = behavior.moves ? behavior.timeSum / behavior.moves : 0;
    behavior.avgDepth = behavior.depthN ? behavior.depthSum / behavior.depthN : null;
  }
  const margin = margins.length
    ? {
      avg: margins.reduce((sum, value) => sum + value, 0) / margins.length,
      min: Math.min(...margins),
      max: Math.max(...margins)
    }
    : { avg: 0, min: 0, max: 0 };
  return { games: (games || []).length, early, margin, bots };
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function ratePhrase(rate) {
  if (!rate || !rate.n) return 'no games';
  const note = rate.tooClose
    ? ' <span class="batch-too-close">too close to call — run more games</span>'
    : '';
  return `${pct(rate.p)} win rate, 95% CI ${pct(rate.low)}–${pct(rate.high)}.${note}`;
}

function recordPhrase(side) {
  return `${side.w} wins, ${side.l} losses, ${side.d} draws`;
}

function botLabel(bot, number) {
  if (!bot) return `Bot ${number}`;
  const level = `${bot.difficulty || 'medium'}`.replace(/^./, (c) => c.toUpperCase());
  if (bot.fixedDepth) return `Bot ${number} (${level}, depth ${bot.fixedDepth})`;
  const seconds = (Number(bot.thinkingTimeMs) || 0) / 1000;
  return `Bot ${number} (${level}, ${seconds.toFixed(1)}s)`;
}

function levelName(difficulty) {
  const text = `${difficulty || 'medium'}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sideSpec(bot, mode) {
  const difficulty = bot && DIFFICULTIES.includes(bot.difficulty) ? bot.difficulty : 'medium';
  if (mode === 'depth') {
    return { difficulty, kind: 'depth', fixedDepth: Math.floor(Number(bot && bot.fixedDepth) || 0), thinkingTimeMs: null };
  }
  return { difficulty, kind: 'time', fixedDepth: null, thinkingTimeMs: Math.round(Number(bot && bot.thinkingTimeMs) || 0) };
}

function sidePhrase(spec) {
  if (spec.kind === 'depth') return `${levelName(spec.difficulty)}, depth ${spec.fixedDepth}`;
  return `${levelName(spec.difficulty)}, ${(spec.thinkingTimeMs / 1000).toFixed(1)}s`;
}

function sideKey(spec) {
  return spec.kind === 'depth' ? `${spec.difficulty}|d|${spec.fixedDepth}` : `${spec.difficulty}|t|${spec.thinkingTimeMs}`;
}

function colorSides(game) {
  const mode = game.searchMode === 'depth' ? 'depth' : 'time';
  const blackBot = game.first === 'B' ? game.botB : game.botA;
  const whiteBot = game.first === 'B' ? game.botA : game.botB;
  return { mode, black: sideSpec(blackBot, mode), white: sideSpec(whiteBot, mode) };
}

function specRank(spec) {
  const level = { hard: 0, medium: 1, easy: 2 }[spec.difficulty] ?? 9;
  const amount = spec.kind === 'depth' ? spec.fixedDepth : spec.thinkingTimeMs;
  return `${level}|${spec.kind}|${amount}`;
}

function deviceBand(game) {
  const bench = game && game.cpuBenchmark;
  return {
    cores: game && game.hardwareConcurrency != null ? game.hardwareConcurrency : 'na',
    memory: game && game.deviceMemory != null ? game.deviceMemory : 'na',
    cpu: bench && bench.band != null ? bench.band : 'na'
  };
}

function moveToken(move) {
  if (!move) return '';
  return typeof move === 'string' ? move : (move.n || '');
}

// A saved game with no boardDepth is a cube of boardSize, unless the move
// list is Classic notation (no Z plane) or the record says it is Classic.
export function isKnownClassicRecord(game) {
  if (!game) return false;
  if (Number(game.boardDepth) === 1) return true;
  if (Number(game.boardSize) !== 8) return false;
  if (game.classic === true || game.boardShape === '8x8x1' || game.variant === 'classic') return true;
  let sawPlane = false;
  let sawFlat = false;
  for (const move of game.moves || []) {
    const token = String(moveToken(move)).trim();
    if (!token || token === 'PASS' || token.startsWith('TIMEOUT')) continue;
    const parts = token.split('-').filter(Boolean);
    if (parts.length >= 3) sawPlane = true;
    else if (parts.length === 2 || /^[A-H][1-8]$/i.test(token)) sawFlat = true;
  }
  return sawFlat && !sawPlane;
}

export function resolvedBoardDepth(game) {
  const recorded = Number(game && game.boardDepth);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  if (isKnownClassicRecord(game)) return 1;
  return Number(game && game.boardSize) || 0;
}

// 2.0.11 and 2.0.12 records have no mode. A single live game was animated.
// Anything else that was saved was a headless batch.
export function resolvedPlayMode(game) {
  if (game && (game.mode === 'animated' || game.mode === 'batch')) return game.mode;
  return game && game.kind === 'single' ? 'animated' : 'batch';
}

// Clock timeouts are kept in history and left out of pooled win rates.
// A game that had a clock and finished on the board still pools: the bots
// do not read that clock, so the moves match an untimed game.
export function excludedFromPool(game) {
  if (!game) return true;
  if (game.endReason === 'timeout') return true;
  if (game.clocked === true) return true;
  if (game.clock && game.clock.timedOut) return true;
  return false;
}

export function boardSizeLabel(size, depth) {
  const label = `${size}×${size}×${depth}`;
  return Number(depth) === 1 ? `${label} (Classic)` : label;
}

// A bot is its difficulty and its fixed depth or time limit.
// The pool is engine, book, board size, board depth, and search mode.
// App version is recorded on the game and shown, and is not part of the key.
// Bot 1 versus Bot 2 does not matter: the two configs are sorted.
// Time-limit pools also require the same CPU benchmark band.
export function matchupKey(game) {
  const sides = colorSides(game);
  const pair = [sideKey(sides.black), sideKey(sides.white)].sort().join('~');
  const parts = [
    game.engineVersion || '',
    game.openingBookId || '',
    String(game.boardSize || ''),
    String(resolvedBoardDepth(game)),
    sides.mode,
    pair
  ];
  if (sides.mode === 'time') parts.push(`cpu:${deviceBand(game).cpu}`);
  return parts.join('\u001f');
}

function addBehavior(behavior, move) {
  if (!move || move.n === 'PASS' || move.src === 'PASS') {
    behavior.passes++;
    return;
  }
  behavior.moves++;
  const ms = Number(move.ms) || 0;
  behavior.timeSum += ms;
  if (ms > behavior.timeMax) behavior.timeMax = ms;
  if (move.hit) behavior.hits++;
  if (move.src === 'SEARCH' || move.src === 'SOLVE') {
    behavior.depthSum += Number(move.depth) || 0;
    behavior.depthN++;
  }
}

// One row per bot config, with a full Black and White record. The same config
// in either slot is the same row.
export function configColorRecords(games) {
  const map = new Map();
  const touch = (spec) => {
    const key = sideKey(spec);
    if (!map.has(key)) {
      map.set(key, { spec, black: emptySide(), white: emptySide(), behavior: emptyBehavior() });
    }
    return map.get(key);
  };
  for (const game of games || []) {
    if (!game) continue;
    const sides = colorSides(game);
    const blackOutcome = game.winner == null ? 'd' : (game.winner === game.first ? 'w' : 'l');
    const whiteOutcome = blackOutcome === 'd' ? 'd' : (blackOutcome === 'w' ? 'l' : 'w');
    addResult(touch(sides.black).black, blackOutcome);
    addResult(touch(sides.white).white, whiteOutcome);
    for (const move of game.moves || []) {
      const slotBot = move.bot === 'B' ? game.botB : game.botA;
      addBehavior(touch(sideSpec(slotBot, sides.mode)).behavior, move);
    }
  }
  return [...map.values()].map((row) => {
    row.blackRate = wilsonInterval(row.black.w, row.black.n);
    row.whiteRate = wilsonInterval(row.white.w, row.white.n);
    row.behavior.avgMs = row.behavior.moves ? row.behavior.timeSum / row.behavior.moves : 0;
    row.behavior.avgDepth = row.behavior.depthN ? row.behavior.depthSum / row.behavior.depthN : null;
    return row;
  }).sort((a, b) => specRank(a.spec).localeCompare(specRank(b.spec)));
}

function configBlockHtml(row) {
  const behavior = row.behavior;
  const avgDepth = behavior.avgDepth == null ? '—' : behavior.avgDepth.toFixed(2);
  return `<div class="batch-bot-block" data-config="${esc(sideKey(row.spec))}">
    <p><strong>${esc(sidePhrase(row.spec))}</strong></p>
    <p>As Black (moves first): ${recordPhrase(row.black)}. ${ratePhrase(row.blackRate)}</p>
    <p>As White (moves second): ${recordPhrase(row.white)}. ${ratePhrase(row.whiteRate)}</p>
    <p class="batch-behavior">Think time avg ${behavior.moves ? behavior.avgMs.toFixed(0) : '—'} ms, max ${behavior.moves ? behavior.timeMax.toFixed(0) : '—'} ms. Hit the time limit ${behavior.hits} time${behavior.hits === 1 ? '' : 's'}. Avg search depth ${avgDepth} over ${behavior.depthN} searched move${behavior.depthN === 1 ? '' : 's'}. Passes ${behavior.passes}.</p>
  </div>`;
}

function devicePhrase(game) {
  const memory = game.deviceMemory == null ? 'memory n/a' : `${game.deviceMemory} GB`;
  const bench = game.cpuBenchmark;
  const cpu = bench ? `${bench.name} ${bench.score} ops/s (band ${bench.band})` : 'no CPU benchmark';
  return `${game.hardwareConcurrency || '?'} cores, ${memory}, ${cpu}`;
}

function modeCounts(games) {
  let batch = 0;
  let animated = 0;
  for (const game of games || []) {
    if (resolvedPlayMode(game) === 'animated') animated++;
    else batch++;
  }
  return { batch, animated };
}

function modeCountPhrase(games) {
  const counts = modeCounts(games);
  const n = (games || []).length;
  return `${n} game${n === 1 ? '' : 's'} (${counts.batch} batch, ${counts.animated} animated)`;
}

// Time-limit pools combine both modes and also show each mode on its own.
function modeSplitHtml(games) {
  const lines = [];
  for (const mode of ['batch', 'animated']) {
    const subset = (games || []).filter((game) => resolvedPlayMode(game) === mode);
    if (!subset.length) continue;
    const rows = configColorRecords(subset);
    const detail = rows.map((row) => `${sidePhrase(row.spec)} as Black ${row.black.w}-${row.black.l}-${row.black.d}, as White ${row.white.w}-${row.white.l}-${row.white.d}`).join('; ');
    const label = mode === 'batch' ? 'Batch' : 'Animated';
    lines.push(`<p class="batch-mode-split">${label}: ${subset.length} game${subset.length === 1 ? '' : 's'}. ${esc(detail)}</p>`);
  }
  return lines.join('');
}

// Pool by config pair. Slot names are ignored. App version is not part of
// the pool. Time-limit pools also require the same CPU benchmark band.
// Fixed-depth pools combine animated and batch. Time-limit pools do too.
// Clock timeouts are omitted.
export function combinedMatchups(games) {
  const groups = new Map();
  for (const game of games || []) {
    if (!game || !game.boardSize || !game.appVersion) continue;
    if (excludedFromPool(game)) continue;
    const key = matchupKey(game);
    if (!groups.has(key)) {
      const sides = colorSides(game);
      groups.set(key, {
        key,
        appVersions: new Set(),
        engineVersion: game.engineVersion,
        openingBookId: game.openingBookId,
        boardSize: game.boardSize,
        boardDepth: resolvedBoardDepth(game),
        searchMode: sides.mode,
        games: [],
        devices: new Set()
      });
    }
    const group = groups.get(key);
    group.games.push(game);
    if (game.appVersion) group.appVersions.add(game.appVersion);
    group.devices.add(devicePhrase(game));
  }
  return [...groups.values()].map((group) => ({
    ...group,
    appVersion: [...group.appVersions].sort().join(', '),
    ...modeCounts(group.games),
    configs: configColorRecords(group.games),
    deviceLines: [...group.devices]
  })).sort((a, b) => b.games.length - a.games.length || String(a.boardSize).localeCompare(String(b.boardSize)) || String(a.boardDepth).localeCompare(String(b.boardDepth)));
}

export function matchupsHtml(games) {
  const pools = combinedMatchups(games);
  if (!pools.length) return '<p>No finished games to pool yet.</p>';
  return pools.map((pool) => {
    const size = boardSizeLabel(pool.boardSize, pool.boardDepth);
    const names = pool.configs.map((row) => sidePhrase(row.spec));
    const title = names.length ? names.join(' vs ') : 'Matchup';
    const deviceNote = pool.searchMode === 'depth'
      ? 'Fixed depth does not depend on device speed, so animated and batch games from different machines are pooled. Devices are still listed.'
      : 'Time-limit games are pooled when the CPU benchmark band matches, animated and batch together. Core count and device memory are listed and are not part of the pool.';
    const split = pool.searchMode === 'time' ? modeSplitHtml(pool.games) : '';
    return `<section class="batch-matchup">
      <h4>${esc(size)} · ${esc(title)}</h4>
      <p>${modeCountPhrase(pool.games)}. Black always moves first. Bots are matched by their settings, not by Bot 1 or Bot 2.</p>
      <p>App ${esc(pool.appVersion)} · Engine ${esc(pool.engineVersion)} · Book ${esc(pool.openingBookId)} · ${pool.searchMode === 'depth' ? 'Fixed depth' : 'Time limit'} · depth ${esc(pool.boardDepth)}</p>
      <p>${esc(deviceNote)}</p>
      <p>Device: ${esc(pool.deviceLines.join('; '))}</p>
      ${split}
      ${pool.configs.map(configBlockHtml).join('')}
    </section>`;
  }).join('');
}

function sparkline(scores) {
  const series = Array.isArray(scores) && scores.length ? scores : [[0, 0]];
  const margins = series.map((pair) => (pair[0] || 0) - (pair[1] || 0));
  const min = Math.min(...margins);
  const max = Math.max(...margins);
  const width = 140;
  const height = 32;
  const span = max - min || 1;
  const points = margins.map((value, index) => {
    const x = margins.length === 1 ? 0 : (index / (margins.length - 1)) * width;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="batch-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function scoreText(scores) {
  return (scores || []).map((pair) => `${pair[0]}–${pair[1]}`).join(', ');
}

function when(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return esc(iso);
  return esc(date.toLocaleString());
}

export function summaryHtml(batch, games) {
  const summary = summarizeGames(games);
  const mode = batch.searchMode === 'depth' ? 'depth' : 'time';
  const modeNote = mode === 'depth'
    ? 'Search mode: fixed depth. The seed reproduces each game exactly, including on another machine. Easy still stops at depth 2 and Medium at depth 5.'
    : 'Search mode: time limit. The seed reproduces random choices. Search depth still depends on machine speed, so the saved move list is the exact game.';
  const unexported = batch.status !== 'running' && !batch.exportedAt && summary.games > 0;
  const lines = [];
  lines.push('<section class="batch-report">');
  if (unexported) {
    lines.push('<p class="batch-unexported-banner" role="status">Unexported results. A cookie or site-data cleaner can erase IndexedDB. Export JSON to keep this batch.</p>');
  }
  lines.push('<h3>Results</h3>');
  lines.push(`<p class="batch-result-count">${summary.games} finished game${summary.games === 1 ? '' : 's'}. Each bot is its settings, not the Bot 1 or Bot 2 slot. Black always moves first.</p>`);
  lines.push(configColorRecords(games).map(configBlockHtml).join(''));
  lines.push(`<p>Score margin |Black − White|: avg ${summary.margin.avg.toFixed(1)}, min ${summary.margin.min}, max ${summary.margin.max}.</p>`);
  lines.push(`<p>Ended early (board not full): ${summary.early}.</p>`);
  lines.push(`<p class="batch-mode-note">${esc(modeNote)}</p>`);

  lines.push('<h3>Setup</h3>');
  lines.push('<dl class="batch-setup-list">');
  const setupRows = [
    ['App version', batch.appVersion],
    ['Engine version', batch.engineVersion],
    ['Opening book', batch.openingBookId],
    ['Board', boardSizeLabel(batch.boardSize, resolvedBoardDepth(batch))],
    ['Bot A', botLabel(batch.botA, 1)],
    ['Bot B', botLabel(batch.botB, 2)],
    ['Search', mode === 'depth' ? 'Fixed depth' : 'Time limit'],
    ['Games asked', batch.requestedGames],
    ['Started', when(batch.startedAt)],
    ['Finished', when(batch.finishedAt)],
    ['Browser', batch.userAgent],
    ['CPU cores', batch.hardwareConcurrency == null ? '—' : batch.hardwareConcurrency],
    ['Device memory', batch.deviceMemory == null ? 'n/a' : `${batch.deviceMemory} GB`],
    ['CPU benchmark', batch.cpuBenchmark
      ? `${batch.cpuBenchmark.name} ${batch.cpuBenchmark.score} ops/s (band ${batch.cpuBenchmark.band}, ${batch.cpuBenchmark.elapsedMs} ms)`
      : 'n/a']
  ];
  for (const [label, value] of setupRows) {
    lines.push(`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`);
  }
  lines.push('</dl>');
  lines.push('<p class="batch-book-note">Each game records whether a bot played from the opening book, and for how many moves. Black moves first. The bots swap colors every game.</p>');

  lines.push('<h3>Games</h3>');
  if (!games.length) {
    lines.push('<p>No finished games.</p>');
  } else {
    lines.push('<ol class="batch-game-list">');
    for (const game of games) {
      const book = game.book || bookUsage(game.moves);
      const nameOf = (slot) => sidePhrase(sideSpec(slot === 'B' ? game.botB : game.botA, game.searchMode === 'depth' ? 'depth' : 'time'));
      const winner = game.winner == null ? 'Draw' : nameOf(game.winner);
      const blackName = nameOf(game.first === 'B' ? 'B' : 'A');
      lines.push('<li>');
      lines.push(`<div class="batch-game-row"><span>Game ${game.index}: ${esc(blackName)} moved first (Black). ${game.black}–${game.white}, ${esc(winner)}, margin ${game.margin}${game.early ? ', ended early' : ''}. Seed ${game.seed}. Book moves ${esc(nameOf('A'))} ${book.A.moves}, ${esc(nameOf('B'))} ${book.B.moves}.</span> ${sparkline(game.scores)} <button type="button" data-replay="${esc(game.id)}">Replay</button></div>`);
      lines.push(`<details><summary>Score over time</summary><p class="batch-series">${esc(scoreText(game.scores))}</p></details>`);
      lines.push('</li>');
    }
    lines.push('</ol>');
  }
  lines.push('</section>');
  return lines.join('');
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function batchToCsv(batch, games) {
  const summary = summarizeGames(games);
  const rows = [['section', 'key', 'bot', 'value']];
  const add = (section, key, value, bot = '') => rows.push([section, key, bot, value]);
  add('setup', 'appVersion', batch.appVersion);
  add('setup', 'engineVersion', batch.engineVersion);
  add('setup', 'openingBookId', batch.openingBookId);
  add('setup', 'boardSize', batch.boardSize);
  add('setup', 'searchMode', batch.searchMode);
  add('setup', 'botA', botLabel(batch.botA, 1));
  add('setup', 'botB', botLabel(batch.botB, 2));
  add('setup', 'requestedGames', batch.requestedGames);
  add('setup', 'startedAt', batch.startedAt);
  add('setup', 'finishedAt', batch.finishedAt);
  add('setup', 'userAgent', batch.userAgent);
  add('setup', 'hardwareConcurrency', batch.hardwareConcurrency);
  add('setup', 'deviceMemory', batch.deviceMemory);
  add('setup', 'cpuBenchmark', batch.cpuBenchmark && batch.cpuBenchmark.score);
  add('setup', 'cpuBenchmarkBand', batch.cpuBenchmark && batch.cpuBenchmark.band);
  add('setup', 'cpuBenchmarkMs', batch.cpuBenchmark && batch.cpuBenchmark.elapsedMs);
  add('setup', 'exportedAt', batch.exportedAt || '');
  add('result', 'games', summary.games);
  add('result', 'early', summary.early);
  add('result', 'marginAvg', summary.margin.avg);
  add('result', 'marginMin', summary.margin.min);
  add('result', 'marginMax', summary.margin.max);
  for (const key of ['A', 'B']) {
    const bot = summary.bots[key];
    add('result', 'wins', bot.overall.w, key);
    add('result', 'losses', bot.overall.l, key);
    add('result', 'draws', bot.overall.d, key);
    add('result', 'winRate', bot.rate.p, key);
    add('result', 'wilsonLow', bot.rate.low, key);
    add('result', 'wilsonHigh', bot.rate.high, key);
    add('result', 'tooClose', bot.rate.tooClose ? 'yes' : 'no', key);
    add('result', 'blackWins', bot.black.w, key);
    add('result', 'blackLosses', bot.black.l, key);
    add('result', 'blackDraws', bot.black.d, key);
    add('result', 'whiteWins', bot.white.w, key);
    add('result', 'whiteLosses', bot.white.l, key);
    add('result', 'whiteDraws', bot.white.d, key);
    add('behavior', 'avgThinkMs', bot.behavior.avgMs, key);
    add('behavior', 'maxThinkMs', bot.behavior.timeMax, key);
    add('behavior', 'timeLimitHits', bot.behavior.hits, key);
    add('behavior', 'avgSearchDepth', bot.behavior.avgDepth, key);
    add('behavior', 'passes', bot.behavior.passes, key);
  }
  for (const row of configColorRecords(games)) {
    const label = sidePhrase(row.spec);
    add('config', 'blackWins', row.black.w, label);
    add('config', 'blackLosses', row.black.l, label);
    add('config', 'blackDraws', row.black.d, label);
    add('config', 'whiteWins', row.white.w, label);
    add('config', 'whiteLosses', row.white.l, label);
    add('config', 'whiteDraws', row.white.d, label);
  }
  const header = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const gameHeader = ['game', 'seed', 'first', 'black', 'white', 'winner', 'margin', 'early', 'passes', 'bookA', 'bookB', 'finishedAt'];
  const gameRows = games.map((game) => {
    const book = game.book || bookUsage(game.moves);
    const passes = (game.moves || []).filter((move) => move.n === 'PASS').length;
    return [game.index, game.seed, game.first, game.black, game.white, game.winner || 'draw', game.margin, game.early ? 1 : 0, passes, book.A.moves, book.B.moves, game.finishedAt];
  });
  return `${header}\n\n${gameHeader.join(',')}\n${gameRows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function exportBundle(batch, games) {
  return {
    format: BATCH_FORMAT,
    formatVersion: BATCH_FORMAT_VERSION,
    batch,
    games
  };
}

function validBot(bot, mode) {
  if (!bot || !DIFFICULTIES.includes(bot.difficulty)) return false;
  if (mode === 'depth') return Number.isFinite(Number(bot.fixedDepth)) && Number(bot.fixedDepth) >= 1;
  return Number.isFinite(Number(bot.thinkingTimeMs)) && Number(bot.thinkingTimeMs) >= 0;
}

export function parseImport(data) {
  if (!data || data.format !== BATCH_FORMAT || data.formatVersion !== BATCH_FORMAT_VERSION) {
    throw new Error('This JSON is not a Cube Reversi batch export.');
  }
  const batch = data.batch;
  const games = data.games;
  if (!batch || !Array.isArray(games)) throw new Error('The export is missing its batch or games.');
  const mode = batch.searchMode === 'depth' ? 'depth' : 'time';
  if (![4, 6, 8].includes(Number(batch.boardSize))) throw new Error('Board size must be 4, 6, or 8.');
  if (!validBot(batch.botA, mode) || !validBot(batch.botB, mode)) throw new Error('Bot setup in the export is not valid.');
  for (const game of games) {
    if (!Array.isArray(game.moves)) throw new Error('A game is missing its move list.');
  }
  return { batch, games };
}

export async function importBundle(data) {
  const parsed = parseImport(data);
  const batchId = newId('b-');
  const now = new Date().toISOString();
  const games = parsed.games.map((game, index) => ({
    ...game,
    id: newId('g-'),
    batchId,
    index: game.index || index + 1
  }));
  const batch = {
    ...parsed.batch,
    id: batchId,
    kind: parsed.batch.kind === 'single' ? 'single' : 'batch',
    status: parsed.batch.status === 'running' ? 'stopped' : (parsed.batch.status || 'complete'),
    exportedAt: now,
    gameIds: games.map((game) => game.id),
    summary: summarizeGames(games)
  };
  for (const game of games) await saveGame(game);
  await saveBatch(batch);
  return batch;
}

const LEVEL_TIME = { easy: 0.1, medium: 0.7, hard: 1.1 };
// Same defaults as CubeReversi.js BOT_DEPTH_DEFAULTS: Easy 2, Medium 3, Hard 5.
const LEVEL_DEPTH = { easy: 2, medium: 3, hard: 5 };

function levelDepth(difficulty) {
  return LEVEL_DEPTH[difficulty] ?? LEVEL_DEPTH.hard;
}

function applyUneditedLevelDepth(depthInput, difficulty) {
  if (!depthInput || depthInput.dataset.edited) return;
  depthInput.value = String(levelDepth(difficulty));
}

function checkedValue(root, name, fallback) {
  const input = root.querySelector(`input[name="${name}"]:checked`);
  return input ? input.value : fallback;
}

function readBot(root, key) {
  const difficulty = checkedValue(root, `batchBot${key}`, 'hard');
  const timeInput = root.querySelector(`#batchBot${key}Time`);
  const depthInput = root.querySelector(`#batchBot${key}Depth`);
  const seconds = Number(timeInput && timeInput.value);
  const depth = Math.floor(Number(depthInput && depthInput.value));
  return {
    difficulty,
    thinkingTimeMs: Number.isFinite(seconds) ? Math.min(10, Math.max(0, seconds)) * 1000 : LEVEL_TIME[difficulty] * 1000,
    fixedDepth: Number.isFinite(depth) ? Math.min(32, Math.max(1, depth)) : levelDepth(difficulty)
  };
}

export function mountBatchController(hooks) {
  const overlay = document.getElementById('batchOverlay');
  const openButton = document.getElementById('batchModeButton');
  if (!overlay || !openButton) return;

  const summaryEl = document.getElementById('batchSummary');
  const progressEl = document.getElementById('batchProgress');
  const progressText = document.getElementById('batchProgressText');
  const progressFill = document.getElementById('batchProgressFill');
  const historyEl = document.getElementById('batchHistory');
  const errorEl = document.getElementById('batchError');
  const startButton = document.getElementById('batchStart');
  const stopButton = document.getElementById('batchStop');
  const backButton = document.getElementById('batchBack');
  const backConfirm = document.getElementById('batchBackConfirm');
  const backConfirmStop = document.getElementById('batchBackConfirmStop');
  const backConfirmCancel = document.getElementById('batchBackConfirmCancel');
  const exportJsonButton = document.getElementById('batchExportJson');
  const exportCsvButton = document.getElementById('batchExportCsv');
  const chooseFolderButton = document.getElementById('batchChooseFolder');
  const changeFolderButton = document.getElementById('batchChangeFolder');
  const saveFolderButton = document.getElementById('batchSaveFolder');
  const exportStatus = document.getElementById('batchExportStatus');
  const folderNote = document.getElementById('batchExportFolderNote');
  const matchupsEl = document.getElementById('batchMatchups');
  const importButton = document.getElementById('batchImport');
  const importFile = document.getElementById('batchImportFile');
  const deleteButton = document.getElementById('batchDelete');
  const runningNote = document.getElementById('batchRunningNote');
  const gameCountInput = document.getElementById('batchGameCount');

  let worker = null;
  let running = false;
  let activeBatch = null;
  let activeGames = [];
  let viewing = null;
  let moveText = '';
  let saveChain = Promise.resolve();
  let exportDir = null;
  const folderApi = typeof window.showDirectoryPicker === 'function';

  function setError(message) {
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  function setExportStatus(message) {
    if (!exportStatus) return;
    exportStatus.hidden = !message;
    exportStatus.textContent = message || '';
  }

  function syncOpenButton() {
    const mode = document.querySelector('input[name="opponentMode"]:checked');
    const show = mode && mode.value === 'botvsbot';
    openButton.hidden = !show;
  }

  function syncSearchFields() {
    const mode = checkedValue(overlay, 'batchSearchMode', 'depth');
    overlay.classList.toggle('batch-depth-mode', mode === 'depth');
    overlay.classList.toggle('batch-time-mode', mode !== 'depth');
  }

  function fillFromStartMenu() {
    const size = document.querySelector('input[name="boardSize"]:checked');
    if (size && ['4', '6', '8'].includes(size.value)) {
      const match = overlay.querySelector(`input[name="batchBoardSize"][value="${size.value}"]`);
      if (match) match.checked = true;
    }
    const copy = (fromName, toName, timeId, depthId) => {
      const selected = document.querySelector(`input[name="${fromName}"]:checked`);
      const difficulty = selected ? selected.value : 'hard';
      const target = overlay.querySelector(`input[name="${toName}"][value="${difficulty}"]`);
      if (target) target.checked = true;
      const time = document.getElementById(timeId);
      const depth = document.getElementById(depthId);
      if (time && !time.dataset.edited) time.value = String(LEVEL_TIME[difficulty] ?? 1.1);
      applyUneditedLevelDepth(depth, difficulty);
    };
    copy('blackBotDifficulty', 'batchBotA', 'batchBotATime', 'batchBotADepth');
    copy('whiteBotDifficulty', 'batchBotB', 'batchBotBTime', 'batchBotBDepth');
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderProgress() {
    if (!activeBatch) {
      progressEl.hidden = true;
      return;
    }
    progressEl.hidden = false;
    const done = activeGames.length;
    const total = activeBatch.requestedGames || 0;
    const winsA = activeGames.filter((game) => game.winner === 'A').length;
    const winsB = activeGames.filter((game) => game.winner === 'B').length;
    const draws = activeGames.filter((game) => game.winner == null).length;
    const ratio = total ? Math.min(100, (done / total) * 100) : 0;
    progressFill.style.width = `${ratio}%`;
    progressText.textContent = running
      ? `Game ${Math.min(done + 1, total)} of ${total}. Finished ${done}. Bot 1 ${winsA}, Bot 2 ${winsB}, draws ${draws}. ${moveText}`
      : `Finished ${done} of ${total}. Bot 1 ${winsA}, Bot 2 ${winsB}, draws ${draws}.`;
  }

  async function showView(id) {
    const loaded = await getBatchWithGames(id);
    viewing = loaded;
    deleteButton.disabled = !loaded;
    exportJsonButton.disabled = !loaded;
    exportCsvButton.disabled = !loaded;
    if (saveFolderButton) saveFolderButton.disabled = !loaded || !exportDir;
    if (!loaded) {
      summaryEl.innerHTML = '';
      return;
    }
    summaryEl.innerHTML = summaryHtml(loaded.batch, loaded.games);
  }

  function historyLabel(batch) {
    const kind = batch.kind === 'single' ? 'Single game' : 'Batch';
    const size = boardSizeLabel(batch.boardSize, resolvedBoardDepth(batch));
    const whenText = batch.startedAt ? new Date(batch.startedAt).toLocaleString() : '';
    const state = batch.status === 'running' ? 'running' : (batch.status === 'stopped' ? 'stopped' : 'done');
    return `${kind} · ${size} · ${state} · ${whenText}`;
  }

  async function refreshHistory() {
    const batches = await listBatches();
    if (matchupsEl) {
      const games = await listAllGames();
      matchupsEl.innerHTML = matchupsHtml(games);
    }
    historyEl.replaceChildren();
    if (!batches.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No saved batches yet.';
      historyEl.appendChild(empty);
      return;
    }
    for (const batch of batches) {
      const item = document.createElement('li');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'batch-history-open';
      open.textContent = historyLabel(batch);
      open.addEventListener('click', () => { showView(batch.id).catch((error) => setError(error.message)); });
      item.appendChild(open);
      if (batch.status !== 'running' && !batch.exportedAt) {
        const badge = document.createElement('span');
        badge.className = 'batch-unexported-badge';
        badge.textContent = 'Unexported results';
        item.appendChild(badge);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'batch-history-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (running && activeBatch && activeBatch.id === batch.id) {
          setError('Stop the batch before deleting it.');
          return;
        }
        await deleteBatchById(batch.id);
        if (viewing && viewing.batch.id === batch.id) {
          viewing = null;
          summaryEl.innerHTML = '';
          deleteButton.disabled = true;
          exportJsonButton.disabled = true;
          exportCsvButton.disabled = true;
          if (saveFolderButton) saveFolderButton.disabled = true;
        }
        await refreshHistory();
      });
      item.appendChild(remove);
      historyEl.appendChild(item);
    }
    if (runningNote) runningNote.hidden = !running;
  }

  function environment() {
    return captureDeviceProfile();
  }

  async function finishActive(status) {
    if (!activeBatch) return;
    running = false;
    activeBatch.status = status;
    activeBatch.finishedAt = new Date().toISOString();
    activeBatch.summary = summarizeGames(activeGames);
    await saveBatch(activeBatch);
    startButton.disabled = false;
    stopButton.disabled = true;
    overlay.querySelectorAll('input, select').forEach((el) => { el.disabled = false; });
    if (runningNote) runningNote.hidden = true;
    renderProgress();
    await refreshHistory();
    await showView(activeBatch.id);
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function onWorkerMessage(event) {
    const data = event.data || {};
    if (data.type === 'move') {
      moveText = `Current game move ${data.ply}.`;
      renderProgress();
      return;
    }
    if (data.type === 'game') {
      const env = environment();
      const game = {
        ...data.game,
        id: newId('g-'),
        batchId: activeBatch.id,
        kind: 'batch',
        mode: 'batch',
        appVersion: APP_VERSION,
        engineVersion: data.game.engineVersion,
        openingBookId: data.game.openingBookId,
        boardSize: activeBatch.boardSize,
        boardDepth: activeBatch.boardSize,
        searchMode: activeBatch.searchMode,
        botA: activeBatch.botA,
        botB: activeBatch.botB,
        userAgent: activeBatch.userAgent,
        hardwareConcurrency: activeBatch.hardwareConcurrency,
        deviceMemory: activeBatch.deviceMemory,
        cpuBenchmark: activeBatch.cpuBenchmark
      };
      if (!game.book) game.book = bookUsage(game.moves);
      if (!activeBatch.engineVersion) activeBatch.engineVersion = game.engineVersion;
      if (!activeBatch.openingBookId) activeBatch.openingBookId = game.openingBookId;
      activeGames.push(game);
      activeBatch.gameIds.push(game.id);
      activeBatch.summary = summarizeGames(activeGames);
      moveText = '';
      renderProgress();
      saveChain = saveChain.then(() => saveGame(game)).then(() => saveBatch(activeBatch)).catch((error) => {
        setError(error.message);
      });
      return;
    }
    if (data.type === 'done') {
      const status = data.stopped ? 'stopped' : 'complete';
      saveChain.then(() => finishActive(status)).catch((error) => setError(error.message));
      return;
    }
    if (data.type === 'error') {
      setError(data.message || 'Batch failed.');
      finishActive('stopped').catch(() => {});
    }
  }

  function startBatch() {
    if (running) return;
    setError('');
    const boardSize = Number(checkedValue(overlay, 'batchBoardSize', '4'));
    const searchMode = checkedValue(overlay, 'batchSearchMode', 'depth') === 'time' ? 'time' : 'depth';
    const games = Math.floor(Number(gameCountInput.value));
    if (![4, 6, 8].includes(boardSize)) { setError('Choose 4×4×4, 6×6×6, or 8×8×8.'); return; }
    if (!Number.isFinite(games) || games < 1 || games > 500) { setError('Number of games must be from 1 to 500.'); return; }
    const botA = readBot(overlay, 'A');
    const botB = readBot(overlay, 'B');
    if (searchMode === 'time' && (botA.thinkingTimeMs > 10000 || botB.thinkingTimeMs > 10000)) {
      setError('Thinking time must be from 0 to 10 seconds.');
      return;
    }
    const env = environment();
    activeGames = [];
    moveText = '';
    saveChain = Promise.resolve();
    activeBatch = {
      id: newId('b-'),
      kind: 'batch',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exportedAt: null,
      requestedGames: games,
      appVersion: APP_VERSION,
      engineVersion: null,
      openingBookId: null,
      boardSize,
      boardDepth: boardSize,
      searchMode,
      botA: searchMode === 'depth'
        ? { difficulty: botA.difficulty, thinkingTimeMs: botA.thinkingTimeMs, fixedDepth: botA.fixedDepth }
        : { difficulty: botA.difficulty, thinkingTimeMs: botA.thinkingTimeMs },
      botB: searchMode === 'depth'
        ? { difficulty: botB.difficulty, thinkingTimeMs: botB.thinkingTimeMs, fixedDepth: botB.fixedDepth }
        : { difficulty: botB.difficulty, thinkingTimeMs: botB.thinkingTimeMs },
      userAgent: env.userAgent,
      hardwareConcurrency: env.hardwareConcurrency,
      deviceMemory: env.deviceMemory,
      cpuBenchmark: env.cpuBenchmark,
      gameIds: [],
      summary: null
    };
    running = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    overlay.querySelectorAll('fieldset input, #batchGameCount').forEach((el) => { el.disabled = true; });
    if (runningNote) runningNote.hidden = false;
    summaryEl.innerHTML = '<p>Batch running headless. You can hide this tab.</p>';
    renderProgress();
    saveBatch(activeBatch).catch((error) => setError(error.message));
    worker = new Worker(new URL('./CubeReversiBatchWorker.js?v=2.0.19', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (event) => {
      setError(event.message || 'The batch worker failed.');
      finishActive('stopped').catch(() => {});
    };
    worker.postMessage({
      type: 'start',
      config: {
        games,
        boardSize,
        searchMode,
        botA: activeBatch.botA,
        botB: activeBatch.botB
      }
    });
    refreshHistory().catch((error) => setError(error.message));
  }

  openButton.addEventListener('click', () => {
    fillFromStartMenu();
    syncSearchFields();
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    refreshHistory().catch((error) => setError(error.message));
    if (activeBatch) renderProgress();
  });

  function hideBackConfirm() {
    if (!backConfirm) return;
    backConfirm.hidden = true;
  }

  function returnToMainMenu() {
    hideBackConfirm();
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    const start = document.getElementById('startOverlay');
    if (start && !start.classList.contains('visible')) {
      start.classList.add('visible');
      start.setAttribute('aria-hidden', 'false');
    }
  }

  function requestStopBatch() {
    if (worker) worker.postMessage({ type: 'stop' });
    if (stopButton) stopButton.disabled = true;
    if (progressText && running) {
      progressText.textContent = `${progressText.textContent} Stopping after the current move.`;
    }
  }

  // Safer than leaving a batch running behind the menu: ask, then stop.
  function backToMainMenu() {
    if (running) {
      if (backConfirm) backConfirm.hidden = false;
      if (backConfirmStop) backConfirmStop.focus();
      return;
    }
    returnToMainMenu();
  }

  if (backButton) backButton.addEventListener('click', backToMainMenu);
  if (backConfirmCancel) backConfirmCancel.addEventListener('click', hideBackConfirm);
  if (backConfirmStop) {
    backConfirmStop.addEventListener('click', () => {
      requestStopBatch();
      returnToMainMenu();
    });
  }

  startButton.addEventListener('click', startBatch);
  stopButton.addEventListener('click', requestStopBatch);

  overlay.addEventListener('change', (event) => {
    if (event.target && event.target.name === 'batchSearchMode') syncSearchFields();
    if (event.target && event.target.name === 'batchBotA') {
      const time = document.getElementById('batchBotATime');
      const depth = document.getElementById('batchBotADepth');
      const difficulty = event.target.value;
      if (time && !time.dataset.edited) time.value = String(LEVEL_TIME[difficulty] ?? 1.1);
      applyUneditedLevelDepth(depth, difficulty);
    }
    if (event.target && event.target.name === 'batchBotB') {
      const time = document.getElementById('batchBotBTime');
      const depth = document.getElementById('batchBotBDepth');
      const difficulty = event.target.value;
      if (time && !time.dataset.edited) time.value = String(LEVEL_TIME[difficulty] ?? 1.1);
      applyUneditedLevelDepth(depth, difficulty);
    }
  });

  for (const id of ['batchBotATime', 'batchBotADepth', 'batchBotBTime', 'batchBotBDepth']) {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', () => { input.dataset.edited = '1'; });
  }

  function exportPayload(kind) {
    const { batch, games } = viewing;
    const stamp = (batch.startedAt || 'batch').replace(/[:.]/g, '-');
    if (kind === 'json') {
      return {
        filename: `cubereversi-batch-${stamp}.json`,
        text: JSON.stringify(exportBundle(batch, games), null, 2),
        type: 'application/json',
        description: 'JSON',
        ext: '.json'
      };
    }
    return {
      filename: `cubereversi-batch-${stamp}.csv`,
      text: batchToCsv(batch, games),
      type: 'text/csv',
      description: 'CSV',
      ext: '.csv'
    };
  }

  async function stampAndRefresh() {
    if (!viewing) return;
    viewing.batch.exportedAt = new Date().toISOString();
    await saveBatch(viewing.batch);
    await refreshHistory();
    await showView(viewing.batch.id);
  }

  function renderExportFolder() {
    const haveFolder = !!(exportDir && folderApi);
    const folderName = haveFolder ? (exportDir.name || 'folder') : '';
    if (saveFolderButton) {
      saveFolderButton.hidden = !haveFolder;
      saveFolderButton.textContent = haveFolder ? `Save to ${folderName}` : 'Save to folder';
      saveFolderButton.disabled = !viewing || !haveFolder;
      saveFolderButton.classList.add('batch-primary');
    }
    if (changeFolderButton) changeFolderButton.hidden = !haveFolder;
    if (chooseFolderButton) {
      chooseFolderButton.hidden = !folderApi || haveFolder;
      chooseFolderButton.classList.toggle('batch-primary', !!(folderApi && !haveFolder));
    }
    const downloadPrimary = !folderApi;
    for (const button of [exportJsonButton, exportCsvButton]) {
      if (!button) continue;
      button.classList.toggle('batch-primary', downloadPrimary);
      button.classList.toggle('batch-secondary', !!folderApi);
    }
    if (!folderNote) return;
    if (!folderApi) {
      folderNote.textContent = 'Exports download to this device. Choosing a folder is not available in this browser.';
      return;
    }
    if (haveFolder) {
      folderNote.textContent = `Export folder: ${folderName}. Download is a fallback and still goes to Downloads.`;
      return;
    }
    folderNote.textContent = 'Choose a folder to save JSON and CSV together, or download them instead.';
  }

  async function writeHandle(handle, payload) {
    const writable = await handle.createWritable();
    await writable.write(new Blob([payload.text], { type: payload.type }));
    await writable.close();
  }

  async function directoryWritable(handle) {
    if (!handle || typeof handle.getFileHandle !== 'function') return false;
    if (typeof handle.queryPermission !== 'function') return true;
    const opts = { mode: 'readwrite' };
    try {
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      if (typeof handle.requestPermission !== 'function') return false;
      return (await handle.requestPermission(opts)) === 'granted';
    } catch {
      return false;
    }
  }

  async function exportView(kind) {
    if (!viewing) return;
    await stampAndRefresh();
    const payload = exportPayload(kind);
    download(payload.filename, payload.text, payload.type);
  }

  async function saveBothToFolder() {
    if (!viewing || !exportDir) return;
    setError('');
    setExportStatus('');
    const folderName = exportDir.name || 'folder';
    const allowed = await directoryWritable(exportDir);
    if (!allowed) {
      setError(`Could not save to ${folderName}. The export folder is not writable.`);
      return;
    }
    const json = exportPayload('json');
    const csv = exportPayload('csv');
    try {
      const jsonHandle = await exportDir.getFileHandle(json.filename, { create: true });
      await writeHandle(jsonHandle, json);
      const csvHandle = await exportDir.getFileHandle(csv.filename, { create: true });
      await writeHandle(csvHandle, csv);
    } catch (error) {
      setExportStatus('');
      setError(error && error.message ? error.message : `Could not save to ${folderName}.`);
      return;
    }
    await stampAndRefresh();
    setExportStatus(`Saved to ${folderName}: ${json.filename}, ${csv.filename}`);
  }

  async function chooseExportFolder() {
    if (!folderApi) return;
    try {
      const handle = await window.showDirectoryPicker({ id: 'cubereversi-batch-export', mode: 'readwrite' });
      exportDir = handle;
      try {
        await saveSetting('exportDirectory', handle);
      } catch (error) {
        // A handle the browser cannot store still works for this visit.
        console.warn('Cube Reversi kept the export folder for this visit only.', error);
      }
      renderExportFolder();
      setError('');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      setError(error.message || 'The folder could not be chosen. Downloads still work.');
    }
  }

  exportJsonButton.addEventListener('click', () => { exportView('json').catch((error) => setError(error.message)); });
  exportCsvButton.addEventListener('click', () => { exportView('csv').catch((error) => setError(error.message)); });
  if (chooseFolderButton) chooseFolderButton.addEventListener('click', () => { chooseExportFolder().catch((error) => setError(error.message)); });
  if (changeFolderButton) changeFolderButton.addEventListener('click', () => { chooseExportFolder().catch((error) => setError(error.message)); });
  if (saveFolderButton) saveFolderButton.addEventListener('click', () => { saveBothToFolder().catch((error) => setError(error.message)); });
  renderExportFolder();
  loadSetting('exportDirectory').then((handle) => {
    if (handle && typeof handle.getFileHandle === 'function') exportDir = handle;
    renderExportFolder();
  }).catch(() => {});
  importButton.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files && importFile.files[0];
    importFile.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const batch = await importBundle(data);
      setError('');
      await refreshHistory();
      await showView(batch.id);
    } catch (error) {
      setError(error.message || 'Import failed.');
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (!viewing) return;
    if (running && activeBatch && activeBatch.id === viewing.batch.id) {
      setError('Stop the batch before deleting it.');
      return;
    }
    const id = viewing.batch.id;
    await deleteBatchById(id);
    viewing = null;
    summaryEl.innerHTML = '';
    deleteButton.disabled = true;
    exportJsonButton.disabled = true;
    exportCsvButton.disabled = true;
    if (saveFolderButton) saveFolderButton.disabled = true;
    await refreshHistory();
  });

  summaryEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-replay]');
    if (!button || !viewing) return;
    const game = viewing.games.find((item) => item.id === button.dataset.replay);
    if (!game) return;
    const message = hooks.replay(game);
    if (message) setError(message);
  });

  document.querySelectorAll('input[name="opponentMode"]').forEach((input) => {
    input.addEventListener('change', syncOpenButton);
  });

  window.addEventListener('keydown', (event) => {
    if (!overlay.classList.contains('visible')) return;
    if (event.key === 'Enter') event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (backConfirm && !backConfirm.hidden) {
        hideBackConfirm();
        return;
      }
      backToMainMenu();
    }
  }, true);

  window.addEventListener('pagehide', () => {
    if (!running || !worker || !activeBatch) return;
    worker.postMessage({ type: 'stop' });
    activeBatch.status = 'stopped';
    activeBatch.finishedAt = new Date().toISOString();
    saveBatch(activeBatch).catch(() => {});
  });

  window.addEventListener('cubereversi-batch-saved', () => {
    refreshHistory().catch(() => {});
  });

  applyUneditedLevelDepth(document.getElementById('batchBotADepth'), checkedValue(overlay, 'batchBotA', 'hard'));
  applyUneditedLevelDepth(document.getElementById('batchBotBDepth'), checkedValue(overlay, 'batchBotB', 'hard'));
  syncOpenButton();
  syncSearchFields();
  sweepStaleBatches().then(() => refreshHistory()).catch(() => {});
}
