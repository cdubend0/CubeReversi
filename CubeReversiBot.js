/*
 * Cube Reversi — Bot Engine
 *
 * The Bot Engine remains a move-selection layer only. CubeReversi.js remains
 * authoritative for game state, rules, legal moves, rendering, turn management,
 * and actually committing moves.
 *
 * 1.27.0 introduces a search-based engine for the first time. The implementation
 * is original Cube Reversi code informed by the documented Othello AI approaches
 * of ccurro/othelloAI and eigenfoo/otto-othello. No source code from either
 * project is copied into this file.
 */

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const INF = 1e15;

// The search is intentionally time-limited so the same engine can serve the
// 8×8×1 Classic board and the much larger 3D boards without freezing the UI.
// Difficulty profiles are deliberately conservative in this first pass.
// Easy uses a shallow search and a small amount of controlled variety. Medium
// uses the full 1.27.0 search profile. Hard searches deeper and for longer.
const DIFFICULTY_PROFILES = {
  easy: { classicTimeMs: 120, threeDTimeMs: 90, classicMaxDepth: 1, threeDMaxDepth: 1, randomness: 0.55 },
  medium: { classicTimeMs: 650, threeDTimeMs: 450, classicMaxDepth: 5, threeDMaxDepth: 3, randomness: 0.0 },
  hard: { classicTimeMs: 3000, threeDTimeMs: 1100, classicMaxDepth: 9, threeDMaxDepth: 4, randomness: 0.0 }
};
const CLASSIC_ENDGAME_EMPTY = 10;
const THREE_D_ENDGAME_EMPTY = 8;

// Incremental 64-bit-style Zobrist hashing (two 32-bit lanes) avoids
// re-serializing the entire board at every search node. The deterministic
// generator keeps hashes stable between searches and releases.
let zobristTables = null;

function createZobristTables(size, depth) {
  const cellCount = size * size * depth;
  let seed = 0x9e3779b9;
  const nextRandom = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const tables = new Array(cellCount * 3);
  for (let i = 0; i < tables.length; i++) {
    tables[i] = [nextRandom(), nextRandom()];
  }
  return tables;
}

function ensureZobristTables(size, depth) {
  const key = `${size}x${depth}`;
  if (!zobristTables || zobristTables.key !== key) {
    zobristTables = { key, values: createZobristTables(size, depth) };
  }
  return zobristTables.values;
}

function cellIndex(x, y, z, size, depth) {
  return ((x * size + y) * depth + z);
}

function hashBoard(board, size, depth) {
  const tables = ensureZobristTables(size, depth);
  let h1 = 0;
  let h2 = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < depth; z++) {
        const value = board[x][y][z];
        const pair = tables[cellIndex(x, y, z, size, depth) * 3 + value];
        h1 ^= pair[0];
        h2 ^= pair[1];
      }
    }
  }
  return [h1 >>> 0, h2 >>> 0];
}

function hashAfterMove(hash, move, flips, player, size, depth) {
  const tables = ensureZobristTables(size, depth);
  let h1 = hash[0] >>> 0;
  let h2 = hash[1] >>> 0;
  const toggle = (x, y, z, from, to) => {
    const base = cellIndex(x, y, z, size, depth) * 3;
    const oldPair = tables[base + from];
    const newPair = tables[base + to];
    h1 ^= oldPair[0] ^ newPair[0];
    h2 ^= oldPair[1] ^ newPair[1];
  };
  toggle(move[0], move[1], move[2], EMPTY, player);
  const other = opponent(player);
  for (const [x, y, z] of flips) toggle(x, y, z, other, player);
  return [h1 >>> 0, h2 >>> 0];
}

function hashKey(player, hash) {
  return `${player}|${hash[0].toString(16)}:${hash[1].toString(16)}`;
}

const CLASSIC_SQUARE_WEIGHTS = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120]
];

function opponent(player) {
  return player === BLACK ? WHITE : BLACK;
}

function inside(x, y, z, size, depth) {
  return (
    x >= 0 && x < size &&
    y >= 0 && y < size &&
    z >= 0 && z < depth
  );
}

function buildDirections(depth) {
  const result = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        if (depth === 1 && dz !== 0) continue;
        result.push([dx, dy, dz]);
      }
    }
  }
  return result;
}

function cloneBoard(board) {
  return board.map((plane) => plane.map((row) => row.slice()));
}

function countDiscs(board, size, depth) {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < depth; z++) {
        const value = board[x][y][z];
        if (value === BLACK) black++;
        else if (value === WHITE) white++;
        else empty++;
      }
    }
  }
  return { black, white, empty };
}

function getFlips(board, move, player, size, depth, directions) {
  const [x, y, z] = move;
  const other = opponent(player);
  const flips = [];

  for (const [dx, dy, dz] of directions) {
    const line = [];
    let cx = x + dx;
    let cy = y + dy;
    let cz = z + dz;

    while (
      inside(cx, cy, cz, size, depth) &&
      board[cx][cy][cz] === other
    ) {
      line.push([cx, cy, cz]);
      cx += dx;
      cy += dy;
      cz += dz;
    }

    if (
      line.length &&
      inside(cx, cy, cz, size, depth) &&
      board[cx][cy][cz] === player
    ) {
      flips.push(...line);
    }
  }

  return flips;
}

function legalMoves(board, player, size, depth, directions) {
  const moves = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < depth; z++) {
        if (board[x][y][z] !== EMPTY) continue;
        if (getFlips(board, [x, y, z], player, size, depth, directions).length) {
          moves.push([x, y, z]);
        }
      }
    }
  }
  return moves;
}

function applyMove(board, move, player, flips) {
  const next = cloneBoard(board);
  next[move[0]][move[1]][move[2]] = player;
  for (const [x, y, z] of flips) next[x][y][z] = player;
  return next;
}

function moveKey(move) {
  return `${move[0]},${move[1]},${move[2]}`;
}

// -----------------------------------------------------------------------------
// Classic Opening Book — the pattern-based
// -----------------------------------------------------------------------------
// The opening book supplements the normal search engine; it never replaces it.
// It is intentionally limited to the 8×8×1 Classic board. Positions are
// canonicalized across all eight geometric symmetries so a known opening line
// remains usable after rotations/reflections of the same position.
//
// Opening references used for the established book lines:
// - Tiger:  F5 D6 C3 D3 C4
// - Rose:   F5 D6 C5 F4 E3 C6 D3 F6 E6 D7
// - Buffalo:F5 F6 E6 D6 C3
// - Heath:  F5 F6 E6 D6 E7
// - Horse:  F5 D6 C5 F4 D3
// - Shaman: F5 D6 C5 F4 E3 C6 F3
// Additional named variations are documented in public Othello opening catalogs.
// The book contains overlapping prefixes and multiple prepared continuations.
const CLASSIC_OPENING_BOOK_LINES = [
  // Core established opening lines.
  { name: 'Rose', priority: 100, moves: 'F5 D6 C5 F4 E3 C6 D3 F6 E6 D7' },
  { name: 'Tiger', priority: 90, moves: 'F5 D6 C3 D3 C4' },
  { name: 'Buffalo', priority: 80, moves: 'F5 F6 E6 D6 C3' },
  { name: 'Heath', priority: 70, moves: 'F5 F6 E6 D6 E7' },
  { name: 'Horse', priority: 60, moves: 'F5 D6 C5 F4 D3' },
  { name: 'Shaman', priority: 50, moves: 'F5 D6 C5 F4 E3 C6 F3' },

  // Expanded established continuations / variations. These are sourced from
  // public Othello opening catalogs and the weltyc/othello openings list.
  { name: 'Mainline Tiger', priority: 95, moves: 'F5 D6 C3 D3 C4 F4 C5 B4 B5 C6 F3 E6 E3 G6 F6 G5 D7 G3' },
  { name: 'Rose-Bill', priority: 89, moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2 E3' },
  { name: 'Tamenori', priority: 88, moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2 E6' },
  { name: "Leader's Tiger", priority: 87, moves: 'F5 D6 C3 D3 C4 F4 F6' },
  { name: 'Stephenson', priority: 86, moves: 'F5 D6 C3 D3 C4 F4 F6' },
  { name: 'Kung', priority: 85, moves: 'F5 D6 C3 D3 C4 F4 F6 B4' },
  { name: "Comp'Oth", priority: 84, moves: 'F5 D6 C3 D3 C4 F4 F6 F3' },
  { name: 'No-Kung', priority: 83, moves: 'F5 D6 C3 D3 C4 F4 F6 G5' },
  { name: 'Ganglion', priority: 82, moves: 'F5 D6 C3 G5' },
  { name: 'Cat', priority: 78, moves: 'F5 D6 C4 D3 C5' },
  { name: 'Berner', priority: 77, moves: 'F5 D6 C4 D3 C5 F4 E3 F3 C2 B4 B3' },
  { name: 'Sakaguchi', priority: 76, moves: 'F5 D6 C4 D3 C5 F4 E3 F3 C2 C6' },
  { name: 'Italian', priority: 75, moves: 'F5 D6 C4 D3 E6' },
  { name: 'No-Cat', priority: 74, moves: 'F5 D6 C4 G5' },
  { name: 'Swallow', priority: 73, moves: 'F5 D6 C4 G5 C6' },
  { name: 'Ralle', priority: 65, moves: 'F5 D6 C5 F4 E3 C6 D3 F3' },
  { name: 'Rose-Birth', priority: 99, moves: 'F5 D6 C5 F4 E3 C6 D3 F6 E6 D7 G3 C4' },
  { name: 'Rose-birdie', priority: 98, moves: 'F5 D6 C5 F4 E3 C6 D3 F6 E6 D7 G3 C4 B4' }
];

const CLASSIC_BOOK_SIZE = 8;
const classicOpeningBook = new Map();

function transformClassicCoord(x, y, transform) {
  switch (transform) {
    case 0: return [x, y];
    case 1: return [7 - y, x];
    case 2: return [7 - x, 7 - y];
    case 3: return [y, 7 - x];
    case 4: return [7 - x, y];
    case 5: return [7 - y, 7 - x];
    case 6: return [x, 7 - y];
    case 7: return [y, x];
    default: return [x, y];
  }
}

function transformClassicMove(move, transform) {
  const [x, y] = transformClassicCoord(move[0], move[1], transform);
  return [x, y, 0];
}

function parseClassicBookMove(token) {
  const match = /^([A-Ha-h])([1-8])$/.exec(token.trim());
  if (!match) return null;
  return [match[1].toUpperCase().charCodeAt(0) - 65, Number(match[2]) - 1, 0];
}

function canonicalClassicPosition(board, player) {
  let bestKey = null;
  let bestTransform = 0;

  for (let transform = 0; transform < 8; transform++) {
    let key = `${player}|`;
    for (let x = 0; x < CLASSIC_BOOK_SIZE; x++) {
      for (let y = 0; y < CLASSIC_BOOK_SIZE; y++) {
        const [tx, ty] = transformClassicCoord(x, y, transform);
        key += board[tx][ty][0];
      }
    }
    if (bestKey === null || key < bestKey) {
      bestKey = key;
      bestTransform = transform;
    }
  }

  return { key: bestKey, transform: bestTransform };
}

function createClassicOpeningBoard() {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => [EMPTY])
  );
  // Standard Classic Reversi opening used by Cube Reversi 1.28.11+:
  // Black E-4 / D-5, White D-4 / E-5.
  board[3][3][0] = WHITE;
  board[3][4][0] = BLACK;
  board[4][3][0] = BLACK;
  board[4][4][0] = WHITE;
  return board;
}

function addClassicBookEntry(board, player, move, name, priority, ply) {
  const canonical = canonicalClassicPosition(board, player);
  const canonicalMove = transformClassicMove(move, canonical.transform);
  const existing = classicOpeningBook.get(canonical.key) || [];
  const moveKeyValue = moveKey(canonicalMove);
  const duplicate = existing.find((entry) => entry.moveKey === moveKeyValue);

  if (duplicate) {
    duplicate.priority = Math.max(duplicate.priority, priority);
    duplicate.ply = Math.max(duplicate.ply, ply);
  } else {
    existing.push({
      move: canonicalMove,
      moveKey: moveKeyValue,
      name,
      priority,
      ply
    });
  }
  classicOpeningBook.set(canonical.key, existing);
}

function buildClassicOpeningBook() {
  classicOpeningBook.clear();
  const directions = buildDirections(1);

  for (const line of CLASSIC_OPENING_BOOK_LINES) {
    const board = createClassicOpeningBoard();
    let player = BLACK;
    const tokens = line.moves.split(/\s+/);

    for (let ply = 0; ply < tokens.length; ply++) {
      const move = parseClassicBookMove(tokens[ply]);
      if (!move) break;
      const flips = getFlips(board, move, player, 8, 1, directions);
      if (!flips.length) break;

      addClassicBookEntry(board, player, move, line.name, line.priority, ply + 1);
      const next = applyMove(board, move, player, flips);
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) board[x][y][0] = next[x][y][0];
      }
      player = opponent(player);
    }
  }
}

function chooseClassicBookMove(board, player, legalMoveOptions) {
  if (!Array.isArray(legalMoveOptions) || !legalMoveOptions.length) return null;

  const canonical = canonicalClassicPosition(board, player);
  const entries = classicOpeningBook.get(canonical.key);
  if (!entries || !entries.length) return null;

  const legalKeys = new Set(legalMoveOptions.map((option) => moveKey(option.move)));
  const candidates = entries
    .map((entry) => ({
      ...entry,
      actualMove: transformClassicMove(entry.move, inverseClassicTransform(canonical.transform))
    }))
    .filter((entry) => legalKeys.has(moveKey(entry.actualMove)));

  if (!candidates.length) return null;

  // Support multiple established continuations without introducing random
  // opening play: prefer the strongest-priority line, then the line that has
  // been prepared furthest into the opening.
  candidates.sort((a, b) =>
    b.priority - a.priority || b.ply - a.ply || a.name.localeCompare(b.name)
  );

  const selected = candidates[0];
  return {
    move: selected.actualMove,
    name: selected.name,
    ply: selected.ply
  };
}

function inverseClassicTransform(transform) {
  for (let candidate = 0; candidate < 8; candidate++) {
    let matches = true;
    for (const point of [[0, 0], [1, 0], [0, 1], [7, 7]]) {
      const [x1, y1] = transformClassicCoord(...point, transform);
      const [x2, y2] = transformClassicCoord(x1, y1, candidate);
      if (x2 !== point[0] || y2 !== point[1]) {
        matches = false;
        break;
      }
    }
    if (matches) return candidate;
  }
  return 0;
}

buildClassicOpeningBook();

function isCorner(move, size, depth) {
  const [x, y, z] = move;
  return (
    (x === 0 || x === size - 1) &&
    (y === 0 || y === size - 1) &&
    (depth === 1 ? z === 0 : (z === 0 || z === depth - 1))
  );
}

function cornerMoves(size, depth) {
  const result = [];
  for (const x of [0, size - 1]) {
    for (const y of [0, size - 1]) {
      for (const z of depth === 1 ? [0] : [0, depth - 1]) {
        result.push([x, y, z]);
      }
    }
  }
  return result;
}

function adjacentToCorner(move, size, depth) {
  for (const corner of cornerMoves(size, depth)) {
    const dx = Math.abs(move[0] - corner[0]);
    const dy = Math.abs(move[1] - corner[1]);
    const dz = Math.abs(move[2] - corner[2]);
    if (Math.max(dx, dy, dz) === 1) return true;
  }
  return false;
}

// A directly available corner is strategically more important than ordinary
// mobility.  In Classic play, a position can look favorable on mobility while
// quietly handing the opponent an immediate corner.  Count legal corner moves
// separately so the evaluator can recognize both corner access and corner
// danger before a corner is actually occupied.  This is intentionally Classic
// only; 3D corner geometry is not yet tuned to this concept.
function classicLegalCornerCount(board, player, size, depth, directions) {
  if (size !== 8 || depth !== 1) return 0;
  let count = 0;
  for (const corner of cornerMoves(size, depth)) {
    if (board[corner[0]][corner[1]][corner[2]] !== EMPTY) continue;
    if (getFlips(board, corner, player, size, depth, directions).length > 0) count++;
  }
  return count;
}

function potentialMobility(board, player, size, depth, directions) {
  const other = opponent(player);
  let count = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < depth; z++) {
        if (board[x][y][z] !== EMPTY) continue;
        let touchesOpponent = false;
        for (const [dx, dy, dz] of directions) {
          const cx = x + dx;
          const cy = y + dy;
          const cz = z + dz;
          if (inside(cx, cy, cz, size, depth) && board[cx][cy][cz] === other) {
            touchesOpponent = true;
            break;
          }
        }
        if (touchesOpponent) count++;
      }
    }
  }
  return count;
}

// Conservative lower-bound stability estimate for Classic Reversi. This is
// intentionally only corner-anchored stability, matching the source projects'
// documented idea of using a lower bound rather than an expensive exact solve.
function classicStableLowerBound(board, player) {
  if (board.length !== 8 || board[0].length !== 8 || board[0][0].length !== 1) {
    return 0;
  }

  const stable = new Set();
  const corners = [[0, 0], [7, 0], [0, 7], [7, 7]];
  const rays = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  for (const [cx, cy] of corners) {
    if (board[cx][cy][0] !== player) continue;
    stable.add(`${cx},${cy}`);
    for (const [dx, dy] of rays) {
      let x = cx + dx;
      let y = cy + dy;
      while (x >= 0 && x < 8 && y >= 0 && y < 8 && board[x][y][0] === player) {
        stable.add(`${x},${y}`);
        x += dx;
        y += dy;
      }
    }
  }
  return stable.size;
}

function classicFrontierCount(board, player) {
  let frontier = 0;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      if (board[x][y][0] !== player) continue;
      let exposed = false;
      for (let dx = -1; dx <= 1 && !exposed; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && board[nx][ny][0] === EMPTY) {
            exposed = true;
            break;
          }
        }
      }
      if (exposed) frontier++;
    }
  }
  return frontier;
}

function classicEdgeBalance(board, player) {
  const other = opponent(player);
  let own = 0;
  let otherCount = 0;
  for (let i = 0; i < 8; i++) {
    const edgeCells = [
      [i, 0], [i, 7], [0, i], [7, i]
    ];
    for (const [x, y] of edgeCells) {
      const value = board[x][y][0];
      if (value === player) own++;
      else if (value === other) otherCount++;
    }
  }
  // Four corners occur twice in the edge list; count each physical edge
  // square once so the score measures edge occupancy rather than corners.
  own -= 2 * [ [0,0], [7,0], [0,7], [7,7] ].filter(([x,y]) => board[x][y][0] === player).length;
  otherCount -= 2 * [ [0,0], [7,0], [0,7], [7,7] ].filter(([x,y]) => board[x][y][0] === other).length;
  return own - otherCount;
}

// classic edge-structure evaluation. Public Othello-engine
// research consistently emphasizes edge patterns rather than treating edge
// squares as isolated positional values. This feature is deliberately
// conservative: it rewards corner-anchored edge runs and penalizes exposed,
// unanchored edge runs when the adjacent corner is still empty. It is not a
// hard rule and does not override search or legal-corner access.
function classicEdgeStructureScore(board, player) {
  const other = opponent(player);
  let score = 0;
  const sides = [
    [[0, 0], [1, 0]],
    [[0, 7], [1, 0]],
    [[0, 0], [0, 1]],
    [[7, 0], [0, 1]]
  ];

  for (const [[cx, cy], [dx, dy]] of sides) {
    const corner = board[cx][cy][0];
    let ownRun = 0;
    let otherRun = 0;
    for (let i = 1; i < 8; i++) {
      const value = board[cx + dx * i][cy + dy * i][0];
      if (value === player) ownRun++;
      else if (value === other) otherRun++;
      else break;
    }

    // A run anchored to our own corner is comparatively safe and can become
    // stable. The same run next to an empty corner is vulnerable because the
    // opponent may be able to work into the corner from the edge.
    if (corner === player) score += ownRun * 6;
    else if (corner === other) score -= ownRun * 4;
    else score -= ownRun * 4;

    if (corner === other) score += otherRun * 6;
    else if (corner === EMPTY) score -= otherRun * 2;
  }

  // The same analysis from the opposite end of each edge catches runs that
  // are attached to the other corner.
  const oppositeSides = [
    [[7, 0], [-1, 0]],
    [[7, 7], [-1, 0]],
    [[0, 7], [0, -1]],
    [[7, 7], [0, -1]]
  ];
  for (const [[cx, cy], [dx, dy]] of oppositeSides) {
    const corner = board[cx][cy][0];
    let ownRun = 0;
    let otherRun = 0;
    for (let i = 1; i < 8; i++) {
      const value = board[cx + dx * i][cy + dy * i][0];
      if (value === player) ownRun++;
      else if (value === other) otherRun++;
      else break;
    }
    if (corner === player) score += ownRun * 6;
    else score -= ownRun * 4;
    if (corner === other) score += otherRun * 6;
    else if (corner === EMPTY) score -= otherRun * 2;
  }

  return score;
}


// Classic pattern-based evaluation.  This is the first
// dedicated pattern layer in the Bot.  It is intentionally conservative and
// hand-weighted rather than pretending to be a trained neural model.  The
// pattern families are inspired by public Othello engines that evaluate
// corner/edge/diagonal configurations as patterns rather than as isolated
// square values.  The independent exact solver will be used later to tune the
// weights from validated positions.
function classicCornerPatternScore(board, player) {
  const other = opponent(player);
  const corners = [
    [0, 0, 1, 1], [7, 0, -1, 1], [0, 7, 1, -1], [7, 7, -1, -1]
  ];
  let score = 0;

  for (const [cx, cy, sx, sy] of corners) {
    const corner = board[cx][cy][0];
    const c1 = board[cx + sx][cy][0];
    const c2 = board[cx][cy + sy][0];
    const x = board[cx + sx][cy + sy][0];
    const nearOwn = (c1 === player ? 1 : 0) + (c2 === player ? 1 : 0);
    const nearOther = (c1 === other ? 1 : 0) + (c2 === other ? 1 : 0);

    // When a corner is empty, the X-square and C-squares are strategically
    // sensitive.  When our corner is secured, those same nearby discs become
    // much safer and contribute positively to the anchored pattern.
    if (corner === EMPTY) {
      if (x === player) score -= 18;
      else if (x === other) score += 10;
      score -= nearOwn * 7;
      score += nearOther * 4;
    } else if (corner === player) {
      score += 22 + nearOwn * 5 - nearOther * 2;
      if (x === player) score += 5;
    } else if (corner === other) {
      score -= 18 + nearOwn * 3 - nearOther * 2;
      if (x === other) score -= 3;
    }

    // The remaining six cells of the 3x3 corner pattern provide a small
    // structural signal.  Favor compact own support and discourage compact
    // opponent support when the corner is ours.
    let ownRing = 0;
    let otherRing = 0;
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        if (dx === 0 && dy === 0) continue;
        const value = board[cx + sx * dx][cy + sy * dy][0];
        if (value === player) ownRing++;
        else if (value === other) otherRing++;
      }
    }
    if (corner === player) score += ownRing * 2 - otherRing;
    else if (corner === EMPTY) score += otherRing - ownRing;
  }
  return score;
}

function classicDiagonalPatternScore(board, player) {
  const other = opponent(player);
  const diagonals = [
    [[0,0],[1,1],[2,2],[3,3],[4,4],[5,5],[6,6],[7,7]],
    [[7,0],[6,1],[5,2],[4,3],[3,4],[2,5],[1,6],[0,7]]
  ];
  let score = 0;

  for (const diagonal of diagonals) {
    let own = 0;
    let opp = 0;
    let longestOwnRun = 0;
    let longestOppRun = 0;
    let currentOwn = 0;
    let currentOpp = 0;

    for (const [x, y] of diagonal) {
      const value = board[x][y][0];
      if (value === player) {
        own++; currentOwn++; currentOpp = 0;
      } else if (value === other) {
        opp++; currentOpp++; currentOwn = 0;
      } else {
        currentOwn = 0; currentOpp = 0;
      }
      longestOwnRun = Math.max(longestOwnRun, currentOwn);
      longestOppRun = Math.max(longestOppRun, currentOpp);
    }

    score += (own - opp) * 2;
    score += (longestOwnRun - longestOppRun) * 4;

    // A diagonal anchored by our corner is more meaningful than the same
    // number of isolated diagonal discs.
    const [sx, sy] = diagonal[0];
    const [ex, ey] = diagonal[diagonal.length - 1];
    if (board[sx][sy][0] === player) score += longestOwnRun * 2;
    if (board[ex][ey][0] === player) score += longestOwnRun * 2;
    if (board[sx][sy][0] === other) score -= longestOwnRun;
    if (board[ex][ey][0] === other) score -= longestOwnRun;
  }

  return score;
}

// add 5x2 corner/edge patterns. Othello Sensei explicitly
// uses 5x2 corner patterns alongside 3x3 corners and diagonals. This layer
// gives the evaluator a longer view of the edge/corner relationship, which is
// especially useful when an apparently harmless edge move leaves the corner
// available to the opponent on the next turn. It remains a soft feature: the
// search is still authoritative, and later solver-guided tuning will set its
// final weight.
function classicCorner5x2PatternScore(board, player) {
  const other = opponent(player);
  const corners = [
    [0, 0, 1, 1], [7, 0, -1, 1], [0, 7, 1, -1], [7, 7, -1, -1]
  ];
  let score = 0;

  for (const [cx, cy, sx, sy] of corners) {
    const corner = board[cx][cy][0];
    let own = 0;
    let opp = 0;
    let edgeOwn = 0;
    let edgeOpp = 0;

    // Five cells along the edge, including the corner.
    for (let i = 0; i < 5; i++) {
      const value = board[cx + sx * i][cy][0];
      if (value === player) { own++; if (i > 0) edgeOwn++; }
      else if (value === other) { opp++; if (i > 0) edgeOpp++; }
    }

    // Five cells on the adjacent row/column. The corner is counted once.
    for (let i = 1; i < 5; i++) {
      const value = board[cx][cy + sy * i][0];
      if (value === player) own++;
      else if (value === other) opp++;
    }

    if (corner === player) {
      score += 18 + own * 3 - opp * 2 + edgeOwn * 2;
    } else if (corner === other) {
      score -= 18 + own * 3 - opp * 2;
      score -= edgeOwn * 2;
    } else {
      // Empty corner: own discs in the 5x2 neighborhood are more exposed,
      // while opponent occupancy reduces the immediate danger. Edge discs
      // receive a little extra penalty because they can help force entry to
      // the corner.
      score -= own * 5;
      score += opp * 3;
      score -= edgeOwn * 2;
      score += edgeOpp;
    }
  }

  return score;
}

// edge-pattern cohesion. Public Othello engines use edge
// configurations as patterns rather than treating every edge square in
// isolation. This feature is deliberately narrower than classicEdgeStructureScore:
// it measures how much of an edge is already safely connected to a friendly
// corner, while penalizing exposed edge occupancy that is not corner-anchored.
// It is a soft strategic signal and remains below the search and corner terms.
function classicEdgePatternScore(board, player) {
  const other = opponent(player);
  const edges = [
    [[0, 0], [1, 0]],
    [[0, 7], [1, 0]],
    [[0, 0], [0, 1]],
    [[7, 0], [0, 1]]
  ];
  let score = 0;

  for (const [[cx, cy], [dx, dy]] of edges) {
    const corner = board[cx][cy][0];
    let ownAnchored = 0;
    let otherAnchored = 0;
    let ownLoose = 0;
    let otherLoose = 0;

    for (let i = 1; i < 8; i++) {
      const value = board[cx + dx * i][cy + dy * i][0];
      if (value === player) {
        if (ownAnchored === i - 1 && (i === 1 || board[cx + dx * (i - 1)][cy + dy * (i - 1)][0] === player)) {
          ownAnchored++;
        } else {
          ownLoose++;
        }
      } else if (value === other) {
        if (otherAnchored === i - 1 && (i === 1 || board[cx + dx * (i - 1)][cy + dy * (i - 1)][0] === other)) {
          otherAnchored++;
        } else {
          otherLoose++;
        }
      } else {
        break;
      }
    }

    if (corner === player) score += ownAnchored * 5;
    else if (corner === other) score -= ownLoose * 2;
    else score -= ownLoose * 2;

    if (corner === other) score -= otherAnchored * 5;
    else if (corner === player) score += otherLoose * 2;
    else score += otherLoose;
  }

  // Evaluate the same four edges from the opposite corner. This catches a
  // safe run that is anchored on the far end without double-counting the
  // whole edge as a positional square score.
  const reverseEdges = [
    [[7, 0], [-1, 0]],
    [[7, 7], [-1, 0]],
    [[0, 7], [0, -1]],
    [[7, 7], [0, -1]]
  ];
  for (const [[cx, cy], [dx, dy]] of reverseEdges) {
    const corner = board[cx][cy][0];
    let ownRun = 0;
    let otherRun = 0;
    for (let i = 1; i < 8; i++) {
      const value = board[cx + dx * i][cy + dy * i][0];
      if (value === player) ownRun++;
      else if (value === other) otherRun++;
      else break;
    }
    if (corner === player) score += ownRun * 5;
    else if (corner === other) score -= ownRun * 2;
    if (corner === other) score -= otherRun * 5;
    else if (corner === EMPTY) score += otherRun;
  }

  return score;
}

// frontier-cluster structure. Frontier count already measures
// how many discs touch empty squares, but it treats every frontier disc as
// equally exposed. Stronger Othello evaluations also consider enclosure and
// local relationships. This feature adds a small structural penalty when a
// player's frontier discs form connected clusters, because clustered frontier
// discs tend to give the opponent more adjacent targets and easier mobility.
// It is intentionally modest and remains a soft evaluation signal.
function classicFrontierClusterScore(board, player) {
  const other = opponent(player);
  let ownClusterLinks = 0;
  let otherClusterLinks = 0;
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  function isFrontier(x, y, color) {
    if (board[x][y][0] !== color) return false;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && board[nx][ny][0] === EMPTY) {
        return true;
      }
    }
    return false;
  }

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const value = board[x][y][0];
      if (value !== player && value !== other) continue;
      if (!isFrontier(x, y, value)) continue;

      // Count each same-color frontier adjacency once by only looking forward
      // in a fixed subset of directions.
      const forward = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (const [dx, dy] of forward) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) continue;
        if (board[nx][ny][0] !== value) continue;
        if (!isFrontier(nx, ny, value)) continue;
        if (value === player) ownClusterLinks++;
        else otherClusterLinks++;
      }
    }
  }

  return otherClusterLinks - ownClusterLinks;
}

// empty-region parity. Othello strategy references treat
// parity as more than simply counting all remaining empty squares: when empty
// squares split into separate regions, the side that moves first in an odd
// region tends to make the last move there, while an even region tends to
// favor the other side. This is only a heuristic because real play can move
// between regions, but it captures a strategic signal that the global parity
// count cannot see.
function classicEmptyRegionParityScore(board, player) {
  const seen = Array.from({ length: 8 }, () => Array(8).fill(false));
  const queue = [];
  const orthogonal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const regions = [];

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      if (seen[x][y] || board[x][y][0] !== EMPTY) continue;
      seen[x][y] = true;
      queue.length = 0;
      queue.push([x, y]);
      let size = 0;

      while (queue.length) {
        const [cx, cy] = queue.pop();
        size++;
        for (const [dx, dy] of orthogonal) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= 8 || ny < 0 || ny >= 8) continue;
          if (seen[nx][ny] || board[nx][ny][0] !== EMPTY) continue;
          seen[nx][ny] = true;
          queue.push([nx, ny]);
        }
      }
      regions.push(size);
    }
  }

  if (!regions.length) return 0;

  // Give small, tactically constrained regions slightly more influence while
  // preventing a single large open region from overwhelming the whole term.
  let score = 0;
  for (const size of regions) {
    const influence = Math.min(3, 1 + (size <= 6 ? 0.5 : 0));
    score += (size % 2 === 1 ? influence : -influence);
  }
  return (100 * score) / regions.length;
}

function classicPatternScore(board, player) {
  return classicCornerPatternScore(board, player) +
    classicDiagonalPatternScore(board, player) +
    classicCorner5x2PatternScore(board, player);
}

// dynamic empty-corner risk. Public Othello heuristics
// commonly treat X/C squares as dangerous while the corresponding corner is
// empty. This feature makes that relationship explicit instead of leaving it
// entirely to the general pattern terms. It is intentionally a soft signal:
// it does not forbid a move and it does not replace search.
function classicCornerRiskScore(board, player, directions) {
  const other = opponent(player);
  const corners = [
    [0, 0, 1, 1], [7, 0, -1, 1], [0, 7, 1, -1], [7, 7, -1, -1]
  ];
  let score = 0;

  for (const [cx, cy, sx, sy] of corners) {
    if (board[cx][cy][0] !== EMPTY) continue;

    const c1 = board[cx + sx][cy][0];
    const c2 = board[cx][cy + sy][0];
    const x = board[cx + sx][cy + sy][0];

    // X-square occupancy is the strongest local warning. C-squares are also
    // risky, but their danger depends more heavily on the surrounding edge.
    if (x === player) score -= 10;
    else if (x === other) score += 7;

    const ownC = (c1 === player ? 1 : 0) + (c2 === player ? 1 : 0);
    const otherC = (c1 === other ? 1 : 0) + (c2 === other ? 1 : 0);
    score -= ownC * 5;
    score += otherC * 3;

    // If the C-square next to an empty corner is occupied by this side and the
    // following edge square is also empty, strengthen the warning. This is the
    // specific edge-tempo shape behind the recurring A7 -> A5 -> A6 failure.
    if (c1 === player && board[cx + 2 * sx][cy][0] === EMPTY) score -= 8;
    if (c2 === player && board[cx][cy + 2 * sy][0] === EMPTY) score -= 8;

    // If the opponent can already take this corner, the danger is immediate.
    // The existing corner-access term remains the primary signal; this smaller
    // term reinforces the local structural context without making it a hard rule.
    const cornerMove = [cx, cy, 0];
    const opponentMoves = legalMoves(board, other, 8, 1, directions);
    if (opponentMoves.some(([x0, y0, z0]) => x0 === cornerMove[0] && y0 === cornerMove[1] && z0 === 0)) {
      score -= 12;
    }
  }
  return score;
}



// edge-intrusion tempo. A recurring failure case showed the
// Bot taking an edge square and then allowing the opponent to immediately play
// into the gap between two of the Bot's edge discs (for example A5/A7 -> A6).
// This is a concrete edge-tempo attack: the opponent does not need immediate
// corner access for the move to damage the edge structure. Count legal edge
// intrusions for both sides and prefer positions where the opponent has fewer.
// Keep it a soft Classic-only signal so genuine edge sacrifices remain possible.
function classicEdgeIntrusionScore(board, player, size, depth, directions) {
  if (depth !== 1 || size !== 8) return 0;

  const other = opponent(player);
  const edges = [
    { axis: 'x', fixed: 0 },
    { axis: 'x', fixed: 7 },
    { axis: 'y', fixed: 0 },
    { axis: 'y', fixed: 7 }
  ];

  function intrusionCount(attacker, target) {
    let count = 0;
    const moves = legalMoves(board, attacker, 8, 1, directions);
    for (const [x, y] of moves) {
      const onEdge = x === 0 || x === 7 || y === 0 || y === 7;
      if (!onEdge) continue;

      for (const edge of edges) {
        const cells = [];
        for (let i = 0; i < 8; i++) {
          const ex = edge.axis === 'x' ? i : edge.fixed;
          const ey = edge.axis === 'x' ? edge.fixed : i;
          cells.push(board[ex][ey][0]);
        }
        const index = edge.axis === 'x' ? x : y;
        const fixedMatch = edge.axis === 'x' ? y === edge.fixed : x === edge.fixed;
        if (!fixedMatch || index < 1 || index > 6) continue;
        if (cells[index] !== EMPTY) continue;
        if (cells[index - 1] === target && cells[index + 1] === target) {
          count++;
          break;
        }
      }
    }
    return count;
  }

  return intrusionCount(player, other) - intrusionCount(other, player);
}

// edge-attack and corner-access stability. Othello edge play
// is governed not just by who currently has corner access, but by which side
// controls the next edge tempo and whether an apparently safe edge can be
// attacked on the following move. This feature supplements the wedge detector
// with a one-move look at edge attacks, unbalanced wings, and exposed gaps.
// It is intentionally tactical and Classic-only.
function classicEdgeAttackScore(board, player, size, depth, directions) {
  if (depth !== 1 || size !== 8) return 0;

  const other = opponent(player);
  const corners = [
    [0, 0], [7, 0], [0, 7], [7, 7]
  ];
  const edges = [
    { axis: 'x', fixed: 0 },
    { axis: 'x', fixed: 7 },
    { axis: 'y', fixed: 0 },
    { axis: 'y', fixed: 7 }
  ];

  function isCorner(x, y) {
    return (x === 0 || x === 7) && (y === 0 || y === 7);
  }

  function edgeAttack(side) {
    const target = opponent(side);
    let score = 0;

    // Count attacks where a legal edge move gives the mover a corner on the
    // next turn. This catches the tempo/corner race that immediate corner
    // access alone misses. A direct next-move corner attack is weighted more
    // heavily than a generic edge attack.
    const moves = legalMoves(board, side, 8, 1, directions);
    for (const move of moves) {
      const [x, y] = move;
      if (isCorner(x, y)) continue;
      const onEdge = x === 0 || x === 7 || y === 0 || y === 7;
      if (!onEdge) continue;

      const flips = getFlips(board, move, side, 8, 1, directions);
      if (!flips.length) continue;
      const next = applyMove(board, move, side, flips);
      for (const [cx, cy] of corners) {
        if (next[cx][cy][0] !== EMPTY) continue;
        if (getFlips(next, [cx, cy, 0], side, 8, 1, directions).length > 0) {
          score += 6;
          break;
        }
      }
    }

    // Recognize dangerous unbalanced edge wings. An occupied C-square with an
    // empty adjacent corner is especially attackable; a one-square gap next to
    // a corner is also tactically sensitive. Keep this soft because some edge
    // patterns are deliberately sacrificed for a tempo.
    for (const edge of edges) {
      const cells = [];
      for (let i = 0; i < 8; i++) {
        const x = edge.axis === 'x' ? i : edge.fixed;
        const y = edge.axis === 'x' ? edge.fixed : i;
        cells.push(board[x][y][0]);
      }
      const leftCorner = cells[0];
      const rightCorner = cells[7];

      if (leftCorner === EMPTY && cells[1] === side) score += 3;
      if (rightCorner === EMPTY && cells[6] === side) score += 3;

      if (leftCorner === EMPTY && cells[1] === side && cells[2] === EMPTY) score += 2;
      if (rightCorner === EMPTY && cells[6] === side && cells[5] === EMPTY) score += 2;

      // A side's exposed C-square is less dangerous when it already has
      // support farther along the same edge. Reward supported edge groups and
      // avoid treating every C-square as a blunder.
      if (leftCorner === EMPTY && cells[1] === side) {
        if (cells.slice(2).some(v => v === side)) score -= 1;
      }
      if (rightCorner === EMPTY && cells[6] === side) {
        if (cells.slice(0, 6).some(v => v === side)) score -= 1;
      }
    }

    return score;
  }

  return edgeAttack(player) - edgeAttack(other);
}

// wedge-to-corner threat detection. A wedge is an edge move
// played between two opponent discs. On an empty-corner edge, that wedge can
// create a corner attack that ordinary C-square/X-square scoring does not see
// directly. This feature looks for legal edge wedges and, more importantly,
// checks whether the wedge creates immediate corner access for the same player.
// It is intentionally tactical and Classic-only.
function classicWedgeThreatScore(board, player, size, depth, directions) {
  if (depth !== 1 || size !== 8) return 0;

  const other = opponent(player);
  const edges = [
    [[0, 0], [1, 0]],
    [[0, 7], [1, 0]],
    [[0, 0], [0, 1]],
    [[7, 0], [0, 1]]
  ];
  const corners = cornerMoves(8, 1);

  function sideThreat(side) {
    const target = opponent(side);
    const moves = legalMoves(board, side, size, depth, directions);
    let wedgeCount = 0;
    let cornerWedgeCount = 0;

    for (const move of moves) {
      const [x, y] = move;
      let isWedge = false;

      for (const [[cx, cy], [dx, dy]] of edges) {
        const onEdge = (x === cx && y >= 1 && y <= 6) ||
          (y === cy && x >= 1 && x <= 6);
        if (!onEdge) continue;

        const isVertical = x === cx;
        const before = isVertical ? [x, y - 1] : [x - 1, y];
        const after = isVertical ? [x, y + 1] : [x + 1, y];
        if (board[before[0]][before[1]][0] === target &&
            board[after[0]][after[1]][0] === target) {
          isWedge = true;
          break;
        }
      }

      if (!isWedge) continue;
      wedgeCount++;

      const flips = getFlips(board, move, side, size, depth, directions);
      if (!flips.length) continue;
      const next = applyMove(board, move, side, flips);
      if (corners.some(([cx, cy, cz]) =>
        next[cx][cy][cz] === EMPTY &&
        getFlips(next, [cx, cy, cz], side, size, depth, directions).length > 0
      )) {
        cornerWedgeCount++;
      }
    }

    return wedgeCount + cornerWedgeCount * 3;
  }

  return sideThreat(player) - sideThreat(other);
}

function ratioScore(own, other) {
  const total = own + other;
  return total ? (100 * (own - other)) / total : 0;
}

function evaluateBreakdown(board, player, size, depth, directions, counts, knownOwnMobility = null) {
  const other = opponent(player);
  const ownCount = player === BLACK ? counts.black : counts.white;
  const otherCount = other === BLACK ? counts.black : counts.white;
  const totalCells = size * size * depth;
  const progress = (totalCells - counts.empty) / totalCells;
  const endgame = counts.empty <= (depth === 1 ? 12 : 24);

  let ownCorners = 0;
  let otherCorners = 0;
  for (const [x, y, z] of cornerMoves(size, depth)) {
    if (board[x][y][z] === player) ownCorners++;
    else if (board[x][y][z] === other) otherCorners++;
  }

  const ownMobility = knownOwnMobility ?? legalMoves(board, player, size, depth, directions).length;
  const otherMobility = legalMoves(board, other, size, depth, directions).length;
  const ownPotential = potentialMobility(board, player, size, depth, directions);
  const otherPotential = potentialMobility(board, other, size, depth, directions);

  let squareScore = 0;
  if (depth === 1 && size === 8) {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const value = board[x][y][0];
        if (value === EMPTY) continue;
        const weight = CLASSIC_SQUARE_WEIGHTS[y][x];
        squareScore += value === player ? weight : -weight;
      }
    }
  } else {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < depth; z++) {
          const value = board[x][y][z];
          if (value === EMPTY) continue;
          let positional = 0;
          if (x === 0 || x === size - 1) positional += 2;
          if (y === 0 || y === size - 1) positional += 2;
          if (z === 0 || z === depth - 1) positional += 2;
          if (isCorner([x, y, z], size, depth)) positional += 18;
          squareScore += value === player ? positional : -positional;
        }
      }
    }
  }

  const stability = depth === 1
    ? 34 * (classicStableLowerBound(board, player) - classicStableLowerBound(board, other))
    : 0;

  let frontierScore = 0;
  let edgeScore = 0;
  let edgeStructureScore = 0;
  let edgePatternScore = 0;
  let frontierClusterScore = 0;
  let regionParityScore = 0;
  let wedgeThreatScore = 0;
  let edgeAttackScore = 0;
  let edgeIntrusionScore = 0;
  let cornerAccessScore = 0;
  if (depth === 1 && size === 8) {
    const ownFrontier = classicFrontierCount(board, player);
    const otherFrontier = classicFrontierCount(board, other);
    frontierScore = ratioScore(otherFrontier, ownFrontier);
    edgeScore = classicEdgeBalance(board, player);
    edgeStructureScore = classicEdgeStructureScore(board, player);
    edgePatternScore = classicEdgePatternScore(board, player);
    frontierClusterScore = classicFrontierClusterScore(board, player);
    regionParityScore = classicEmptyRegionParityScore(board, player);
    wedgeThreatScore = classicWedgeThreatScore(board, player, size, depth, directions);
    edgeAttackScore = classicEdgeAttackScore(board, player, size, depth, directions);
    edgeIntrusionScore = classicEdgeIntrusionScore(board, player, size, depth, directions);
    const ownLegalCorners = classicLegalCornerCount(board, player, size, depth, directions);
    const otherLegalCorners = classicLegalCornerCount(board, other, size, depth, directions);
    cornerAccessScore = ownLegalCorners - otherLegalCorners;
  }

  const mobilityWeight = endgame ? 12 : (progress < 0.35 ? 34 : 30);
  const potentialWeight = endgame ? 3 : (progress < 0.35 ? 12 : 8);
  const frontierWeight = depth === 1 ? (endgame ? 12 : (progress < 0.45 ? 18 : 14)) : 0;
  const frontierClusterWeight = depth === 1 ? (endgame ? 2 : 4) : 0;
  const regionParityWeight = depth === 1 ? (endgame ? 7 : (progress > 0.70 ? 4 : 1.5)) : 0;
  const wedgeThreatWeight = depth === 1 ? (endgame ? 120 : (progress > 0.55 ? 90 : 60)) : 0;
  const edgeAttackWeight = depth === 1 ? (endgame ? 55 : (progress > 0.55 ? 40 : 28)) : 0;
  const edgeIntrusionWeight = depth === 1 ? (endgame ? 18 : (progress > 0.55 ? 24 : 20)) : 0;
  const edgeWeight = depth === 1 ? (endgame ? 8 : (progress < 0.45 ? 3 : 6)) : 0;
  const edgeStructureWeight = depth === 1 ? (endgame ? 5 : 7) : 0;
  const edgePatternWeight = depth === 1 ? (endgame ? 2 : 4) : 0;
  const patternWeight = depth === 1 ? (endgame ? 4 : (progress < 0.35 ? 9 : 7)) : 0;
  const cornerPattern5x2Weight = depth === 1 ? (endgame ? 3 : 5) : 0;
  const cornerRiskWeight = depth === 1 ? (endgame ? 9 : 14) : 0;
  const cornerWeight = endgame ? 125 : 115;
  const cornerAccessWeight = endgame ? 140 : 95;
  const squareWeight = endgame ? 0.35 : (progress < 0.30 ? 1.1 : 0.8);
  const discWeight = progress < 0.45 ? 1.5 : (endgame ? 24 : 6);
  const parityWeight = endgame ? 20 : (progress > 0.70 ? 5 : 1);

  const mobilityScore = ratioScore(ownMobility, otherMobility);
  const potentialScore = ratioScore(ownPotential, otherPotential);
  const discScore = ratioScore(ownCount, otherCount);
  const parityScore = counts.empty % 2 === 1 ? 1 : -1;

  const components = {
    corners: cornerWeight * (ownCorners - otherCorners),
    cornerAccess: cornerAccessWeight * cornerAccessScore,
    mobility: mobilityWeight * mobilityScore,
    potential: potentialWeight * potentialScore,
    frontier: frontierWeight * frontierScore,
    frontierCluster: frontierClusterWeight * frontierClusterScore,
    regionParity: regionParityWeight * regionParityScore,
    wedgeThreat: wedgeThreatWeight * wedgeThreatScore,
    edgeAttack: edgeAttackWeight * edgeAttackScore,
    edgeIntrusion: edgeIntrusionWeight * edgeIntrusionScore,
    edge: edgeWeight * edgeScore,
    edgeStructure: edgeStructureWeight * edgeStructureScore,
    edgePattern: edgePatternWeight * edgePatternScore,
    patterns: patternWeight * (classicCornerPatternScore(board, player) + classicDiagonalPatternScore(board, player)),
    cornerPattern5x2: cornerPattern5x2Weight * classicCorner5x2PatternScore(board, player),
    cornerRisk: cornerRiskWeight * classicCornerRiskScore(board, player, directions),
    discs: discWeight * discScore,
    parity: parityWeight * parityScore,
    position: squareWeight * squareScore,
    stability
  };
  components.total = Object.entries(components)
    .filter(([key]) => key !== 'total')
    .reduce((sum, [, value]) => sum + value, 0);
  return components;
}

function evaluate(board, player, size, depth, directions, counts, knownOwnMobility = null) {
  return evaluateBreakdown(board, player, size, depth, directions, counts, knownOwnMobility).total;
}

function terminalScore(board, player, size, depth, directions, counts) {
  const own = player === BLACK ? counts.black : counts.white;
  const other = player === BLACK ? counts.white : counts.black;
  if (own > other) return 1000000 + (own - other) * 1000;
  if (own < other) return -1000000 - (other - own) * 1000;
  return 0;
}

function orderMoves(board, moves, player, size, depth, directions, preferredKey = null) {
  return moves
    .map((move) => {
      const flips = getFlips(board, move, player, size, depth, directions);
      let score = flips.length;
      if (isCorner(move, size, depth)) score += 100000;
      else if (adjacentToCorner(move, size, depth)) score -= 2500;
      if (preferredKey && moveKey(move) === preferredKey) score += 50000;
      return { move, flips, score };
    })
    .sort((a, b) => b.score - a.score);
}

function orderedEntriesFromCache(entries, player, size, depth, preferredKey = null, searchState = null, remainingDepth = 0) {
  return entries
    .map((entry) => {
      let score = entry.flips.length;
      const key = moveKey(entry.move);
      if (isCorner(entry.move, size, depth)) score += 100000;
      else if (adjacentToCorner(entry.move, size, depth)) score -= 2500;
      if (preferredKey && key === preferredKey) score += 50000;
      if (searchState) {
        const killerA = searchState.killers.get(remainingDepth)?.[0] || null;
        const killerB = searchState.killers.get(remainingDepth)?.[1] || null;
        if (key === killerA) score += 18000;
        else if (key === killerB) score += 14000;
        score += searchState.history.get(key) || 0;
      }
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score);
}

function generateMoveEntries(board, player, size, depth, directions) {
  const entries = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < depth; z++) {
        if (board[x][y][z] !== EMPTY) continue;
        const move = [x, y, z];
        const flips = getFlips(board, move, player, size, depth, directions);
        if (flips.length) entries.push({ move, flips });
      }
    }
  }
  return entries;
}

function createSearchState(board, player, size, depth, directions, deadline, collectRootDiagnostics = false) {
  return {
    board,
    player,
    size,
    depth,
    directions,
    deadline,
    // Reused across iterative-deepening iterations.
    table: new Map(),
    moveCache: new Map(),
    principalMove: null,
    timedOut: false,
    nodes: 0,
    leaves: 0,
    cutoffs: 0,
    collectRootDiagnostics,
    // Search-ordering memory is intentionally per move search so stale game
    // history cannot bias a new position.
    killers: new Map(),
    history: new Map()
  };
}

function searchNode(state, board, player, remainingDepth, alpha, beta, passAllowed, hash) {
  if (performance.now() >= state.deadline) {
    state.timedOut = true;
    return 0;
  }

  state.nodes++;
  const originalAlpha = alpha;
  const originalBeta = beta;
  const key = hashKey(player, hash);
  const cached = state.table.get(key);
  let cachedMove = null;

  if (cached) {
    cachedMove = cached.bestMove || null;
    if (cached.depth >= remainingDepth) {
      if (cached.flag === 'EXACT') return cached.score;
      if (cached.flag === 'LOWER') alpha = Math.max(alpha, cached.score);
      else if (cached.flag === 'UPPER') beta = Math.min(beta, cached.score);
      if (alpha >= beta) return cached.score;
    }
  }

  const counts = countDiscs(board, state.size, state.depth);
  let entries = state.moveCache.get(key);
  if (!entries) {
    entries = generateMoveEntries(board, player, state.size, state.depth, state.directions);
    state.moveCache.set(key, entries);
  }
  const moves = entries.map((entry) => entry.move);

  if (!moves.length) {
    const other = opponent(player);
    const otherHashKey = hashKey(other, hash);
    let otherEntries = state.moveCache.get(otherHashKey);
    if (!otherEntries) {
      otherEntries = generateMoveEntries(board, other, state.size, state.depth, state.directions);
      state.moveCache.set(otherHashKey, otherEntries);
    }
    const otherMoves = otherEntries.map((entry) => entry.move);
    if (!otherMoves.length || !passAllowed) {
      const score = terminalScore(board, player, state.size, state.depth, state.directions, counts);
      state.table.set(key, { score, depth: remainingDepth, flag: 'EXACT', bestMove: null });
      return score;
    }
    return -searchNode(state, board, other, remainingDepth, -beta, -alpha, false, hash);
  }

  if (remainingDepth <= 0) {
    state.leaves++;
    const score = evaluate(board, player, state.size, state.depth, state.directions, counts, moves.length);
    state.table.set(key, { score, depth: remainingDepth, flag: 'EXACT', bestMove: null });
    return score;
  }

  let best = -INF;
  let bestMove = null;
  const ordered = orderedEntriesFromCache(
    entries, player, state.size, state.depth, cachedMove, state, remainingDepth
  );

  for (const entry of ordered) {
    const next = applyMove(board, entry.move, player, entry.flips);
    const nextHash = hashAfterMove(hash, entry.move, entry.flips, player, state.size, state.depth);
    const score = -searchNode(
      state, next, opponent(player), remainingDepth - 1, -beta, -alpha, true, nextHash
    );
    if (state.timedOut) return 0;
    if (score > best) {
      best = score;
      bestMove = entry.move;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      state.cutoffs++;
      const moveKeyValue = moveKey(entry.move);
      const historyBonus = Math.min(4096, remainingDepth * remainingDepth * 16);
      state.history.set(
        moveKeyValue,
        Math.min(200000, (state.history.get(moveKeyValue) || 0) + historyBonus)
      );
      const killers = state.killers.get(remainingDepth) || [];
      if (killers[0] !== moveKeyValue) {
        state.killers.set(remainingDepth, [moveKeyValue, killers[0] || null]);
      }
      break;
    }
  }

  const flag = best <= originalAlpha
    ? 'UPPER'
    : best >= originalBeta
      ? 'LOWER'
      : 'EXACT';
  state.table.set(key, { score: best, depth: remainingDepth, flag, bestMove });
  return best;
}

function searchRoot(board, player, moves, size, depth, directions, maxDepth, deadline, previousBest, state, rootHash) {
  let bestMove = previousBest || moves[0];
  let bestScore = -INF;
  const candidates = [];
  state.timedOut = false;
  state.deadline = deadline;
  let ordered = orderMoves(
    board, moves, player, size, depth, directions, previousBest ? moveKey(previousBest) : null
  );
  const rootKillers = state.killers.get(maxDepth) || [];
  ordered = ordered
    .map((entry) => {
      const key = moveKey(entry.move);
      let score = entry.score + (state.history.get(key) || 0);
      if (key === rootKillers[0]) score += 18000;
      else if (key === rootKillers[1]) score += 14000;
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const entry of ordered) {
    if (performance.now() >= deadline) {
      state.timedOut = true;
      break;
    }
    const next = applyMove(board, entry.move, player, entry.flips);
    const nextHash = hashAfterMove(rootHash, entry.move, entry.flips, player, size, depth);
    let score;
    if (state.collectRootDiagnostics || bestScore === -INF) {
      score = -searchNode(state, next, opponent(player), maxDepth - 1, -INF, INF, true, nextHash);
    } else {
      // root Principal Variation Search. Later root moves are
      // first searched with a null window and are fully re-searched only when
      // they prove capable of beating the current root best. This changes
      // search efficiency, not the evaluator or move-selection policy.
      score = -searchNode(
        state, next, opponent(player), maxDepth - 1,
        -bestScore - 1, -bestScore, true, nextHash
      );
      if (!state.timedOut && score > bestScore) {
        score = -searchNode(
          state, next, opponent(player), maxDepth - 1,
          -INF, -bestScore, true, nextHash
        );
      }
    }
    if (state.timedOut) break;
    const candidateBreakdown = evaluateBreakdown(
      next, player, size, depth, directions, countDiscs(next, size, depth)
    );
    candidates.push({
      move: entry.move.slice(),
      score,
      breakdown: candidateBreakdown
    });
    if (score > bestScore) {
      bestScore = score;
      bestMove = entry.move;
    }
  }

  return { move: bestMove, score: bestScore, completed: !state.timedOut, candidates };
}

function legacyFallback(moveOptions) {
  const bestOpponentMoves = Math.min(...moveOptions.map((option) => option.opponentMoves));
  const opponentMobilityLeaders = moveOptions.filter(
    (option) => option.opponentMoves === bestOpponentMoves
  );
  const bestOwnMoves = Math.max(...opponentMobilityLeaders.map((option) => option.ownMoves));
  const ownMobilityLeaders = opponentMobilityLeaders.filter(
    (option) => option.ownMoves === bestOwnMoves
  );
  const bestCornerPosition = Math.max(...moveOptions.map((option) => option.cornerPosition));
  const cornerLeaders = moveOptions.filter(
    (option) => option.cornerPosition === bestCornerPosition
  );
  const cornerOpponentMoves = Math.min(...cornerLeaders.map((option) => option.opponentMoves));
  const cornerMobilityLeaders = cornerLeaders.filter(
    (option) => option.opponentMoves === cornerOpponentMoves
  );
  const cornerOwnMoves = Math.max(...cornerMobilityLeaders.map((option) => option.ownMoves));
  const cornerOwnMobilityLeaders = cornerMobilityLeaders.filter(
    (option) => option.ownMoves === cornerOwnMoves
  );
  const cornerSurfaceMoves = Math.min(
    ...cornerOwnMobilityLeaders.map((option) => option.opponentSurfaceMoves)
  );
  const finalLeaders = cornerOwnMobilityLeaders.filter(
    (option) => option.opponentSurfaceMoves === cornerSurfaceMoves
  );
  const bestFlips = Math.max(...finalLeaders.map((option) => option.flips));
  const bestOptions = finalLeaders.filter((option) => option.flips === bestFlips);
  return bestOptions[Math.floor(Math.random() * bestOptions.length)].move;
}

export function chooseMove(moveOptions, context = null) {
  if (!Array.isArray(moveOptions) || moveOptions.length === 0) return null;

  // Keep the established engine available if an older controller calls the
  // Bot Engine without supplying a board snapshot.
  if (!context || !Array.isArray(context.board)) return legacyFallback(moveOptions);

  const board = context.board;
  const size = context.boardSize;
  const depth = context.boardDepth ?? (board[0]?.[0]?.length || 1);
  const player = context.player;
  const directions = buildDirections(depth);
  const counts = countDiscs(board, size, depth);
  const profile = DIFFICULTY_PROFILES[context.difficulty] || DIFFICULTY_PROFILES.medium;

  // established Classic openings are consulted before search.
  // The authoritative controller still supplies the legal move list, and the
  // book is never used for 3D boards.
  if (depth === 1 && size === 8 && context.difficulty !== 'easy') {
    const bookResult = chooseClassicBookMove(board, player, moveOptions);
    if (bookResult) {
      chooseMove.lastSearchStats = {
        nodes: 0,
        leaves: 0,
        cutoffs: 0,
        tableEntries: 0,
        completedDepth: 0,
        targetDepth: 0,
        source: 'BOOK',
        bookName: bookResult.name,
        bookPly: bookResult.ply
      };
      return bookResult.move;
    }
  }

  const maxDepth = depth === 1 ? profile.classicMaxDepth : profile.threeDMaxDepth;
  const timeLimit = depth === 1 ? profile.classicTimeMs : profile.threeDTimeMs;
  const deadline = performance.now() + timeLimit;

  // Hard Classic uses a 3-second budget so the search can exploit the improved move ordering.
  // Near a finished game, favor complete search. Iterative deepening will still
  // stop at the time limit, so the browser remains responsive.
  const targetDepth = profile.randomness > 0
    ? maxDepth
    : counts.empty <= (depth === 1 ? CLASSIC_ENDGAME_EMPTY : THREE_D_ENDGAME_EMPTY)
      ? Math.max(maxDepth, counts.empty + 2)
      : maxDepth;

  let bestMove = moveOptions[0].move;
  let previousBest = bestMove;
  let completedDepth = 0;
  const rootCandidateScoreHistory = [];

  // Iterative deepening reuses one search state and transposition table across
  // completed iterations. Deeper searches can therefore reuse earlier work and
  // the stored principal move can improve move ordering.
  const searchState = createSearchState(
    board, player, size, depth, directions, deadline, Boolean(context.developerMode)
  );
  const rootHash = hashBoard(board, size, depth);

  for (let currentDepth = 1; currentDepth <= targetDepth; currentDepth++) {
    const result = searchRoot(
      board,
      player,
      moveOptions.map((option) => option.move),
      size,
      depth,
      directions,
      currentDepth,
      deadline,
      previousBest,
      searchState,
      rootHash
    );
    if (!result.completed) break;
    bestMove = result.move;
    previousBest = result.move;
    completedDepth = currentDepth;
    rootCandidateScoreHistory.push({
      depth: currentDepth,
      candidates: result.candidates.map((candidate) => ({
        move: candidate.move.slice(),
        score: candidate.score,
        breakdown: candidate.breakdown ? { ...candidate.breakdown } : null
      }))
    });
    if (performance.now() >= deadline) break;
  }

  chooseMove.lastSearchStats = {
    nodes: searchState.nodes,
    leaves: searchState.leaves,
    cutoffs: searchState.cutoffs,
    tableEntries: searchState.table.size,
    completedDepth,
    targetDepth,
    source: 'SEARCH',
    bookName: null,
    bookPly: 0,
    rootCandidateScores: rootCandidateScoreHistory.length
      ? rootCandidateScoreHistory[rootCandidateScoreHistory.length - 1].candidates
      : [],
    rootCandidateScoreHistory
  };

  // Easy mode intentionally avoids always selecting the mathematically best
  // shallow-search move. Prefer the top few candidates, weighted toward the
  // search result, so Easy remains playable rather than purely random.
  if (profile.randomness > 0 && moveOptions.length > 1) {
    const ranked = moveOptions
      .map((option) => {
        const optionFlips = getFlips(board, option.move, player, size, depth, directions);
        const nextBoard = applyMove(board, option.move, player, optionFlips);
        const nextCounts = countDiscs(nextBoard, size, depth);
        return {
          option,
          score: evaluate(nextBoard, player, size, depth, directions, nextCounts)
        };
      })
      .sort((a, b) => b.score - a.score);
    const poolSize = Math.min(4, ranked.length);
    const pool = ranked.slice(0, poolSize);
    const index = Math.floor(Math.pow(Math.random(), 1.7) * pool.length);
    bestMove = pool[index].option.move;
  }

  // Keep the authoritative controller's legal move set as the final safety
  // check. The Bot Engine never commits a move itself.
  return moveOptions.some((option) => moveKey(option.move) === moveKey(bestMove))
    ? bestMove
    : moveOptions[0].move;
}
