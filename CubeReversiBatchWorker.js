import { runHeadlessGame } from './CubeReversiBot.js?v=2.0.19';

// Headless Bot vs Bot. The page can be hidden; this worker is not a timer
// on the main thread, and it yields with MessageChannel (not setTimeout)
// so a Stop message is seen without Chrome's background timer clamp.
let stop = false;

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type === 'stop') {
    stop = true;
    return;
  }
  if (data.type !== 'start') return;
  stop = false;
  const config = data.config || {};
  const total = Math.max(0, Math.min(500, Math.floor(Number(config.games) || 0)));
  try {
    for (let i = 0; i < total; i++) {
      if (stop) {
        self.postMessage({ type: 'done', stopped: true });
        return;
      }
      const seed = (Math.floor(Math.random() * 0x100000000) >>> 0) || 1;
      const game = await runHeadlessGame({
        size: config.boardSize,
        searchMode: config.searchMode,
        first: i % 2 === 0 ? 'A' : 'B',
        seed,
        botA: config.botA,
        botB: config.botB,
        shouldStop: () => stop,
        onMove: (info) => {
          self.postMessage({ type: 'move', index: i, total, ply: info.ply, move: info.move });
        }
      });
      if (!game || game.stopped) {
        self.postMessage({ type: 'done', stopped: true });
        return;
      }
      game.index = i + 1;
      game.finishedAt = new Date().toISOString();
      self.postMessage({ type: 'game', game, total });
    }
    self.postMessage({ type: 'done', stopped: false });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error && error.message ? error.message : String(error)
    });
  }
};
