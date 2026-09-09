/*
 * Cube Reversi 1.28.22 — Bot Engine
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
  hard: { classicTimeMs: 1600, threeDTimeMs: 1100, classicMaxDepth: 7, threeDMaxDepth: 4, randomness: 0.0 }
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
// Classic Opening Book — Version 1.28.22
// -----------------------------------------------------------------------------
// The opening book supplements the normal search engine; it never replaces it.
// It is intentionally limited to the 8×8×1 Classic board. Positions are
// canonicalized across all eight geometric symmetries so a known opening line
// remains usable after rotations/reflections of the same position.
//
// Opening references used for the initial book lines:
// - Tiger:  F5 D6 C3 D3 C4
// - Rose:   F5 D6 C5 F4 E3 C6 D3 F6 E6 D7
// - Buffalo:F5 F6 E6 D6 C3
// - Heath:  F5 F6 E6 D6 E7
// - Horse:  F5 D6 C5 F4 D3
// - Shaman: F5 D6 C5 F4 E3 C6 F3
// These named lines are established in public Othello opening references.
// The book contains multiple continuations where the supplied lines overlap.
const CLASSIC_OPENING_BOOK_LINES = [
  { name: 'Tiger', priority: 90, moves: 'F5 D6 C3 D3 C4' },
  { name: 'Rose', priority: 100, moves: 'F5 D6 C5 F4 E3 C6 D3 F6 E6 D7' },
  { name: 'Buffalo', priority: 80, moves: 'F5 F6 E6 D6 C3' },
  { name: 'Heath', priority: 70, moves: 'F5 F6 E6 D6 E7' },
  { name: 'Horse', priority: 60, moves: 'F5 D6 C5 F4 D3' },
  { name: 'Shaman', priority: 50, moves: 'F5 D6 C5 F4 E3 C6 F3' }
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

function ratioScore(own, other) {
  const total = own + other;
  return total ? (100 * (own - other)) / total : 0;
}

function evaluate(board, player, size, depth, directions, counts, knownOwnMobility = null) {
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
    // For 3D boards, use deliberately modest geometry-neutral values. The
    // engine should not assume that 2D Othello's edge patterns are universally
    // correct on a cube.
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
  if (depth === 1 && size === 8) {
    const ownFrontier = classicFrontierCount(board, player);
    const otherFrontier = classicFrontierCount(board, other);
    frontierScore = ratioScore(otherFrontier, ownFrontier);
    edgeScore = classicEdgeBalance(board, player);
  }

  // Phase-adaptive Classic weights. Early positions emphasize mobility and
  // avoiding exposed discs; edge/stability influence grows as the board fills;
  // disc count and parity become important only in the endgame.
  const mobilityWeight = endgame ? 12 : (progress < 0.35 ? 34 : 30);
  const potentialWeight = endgame ? 3 : (progress < 0.35 ? 16 : 11);
  const frontierWeight = depth === 1 ? (endgame ? 12 : (progress < 0.45 ? 18 : 14)) : 0;
  const edgeWeight = depth === 1 ? (endgame ? 8 : (progress < 0.45 ? 3 : 6)) : 0;
  const cornerWeight = endgame ? 125 : 115;
  const squareWeight = endgame ? 0.35 : (progress < 0.30 ? 1.1 : 0.8);
  const discWeight = progress < 0.45 ? 1.5 : (endgame ? 24 : 6);
  const parityWeight = endgame ? 20 : (progress > 0.70 ? 5 : 1);

  const mobilityScore = ratioScore(ownMobility, otherMobility);
  const potentialScore = ratioScore(ownPotential, otherPotential);
  const discScore = ratioScore(ownCount, otherCount);
  const parityScore = counts.empty % 2 === 1 ? 1 : -1;

  return (
    cornerWeight * (ownCorners - otherCorners) +
    mobilityWeight * mobilityScore +
    potentialWeight * potentialScore +
    frontierWeight * frontierScore +
    edgeWeight * edgeScore +
    discWeight * discScore +
    parityWeight * parityScore +
    squareWeight * squareScore +
    stability
  );
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

function orderedEntriesFromCache(entries, player, size, depth, preferredKey = null) {
  return entries
    .map((entry) => {
      let score = entry.flips.length;
      if (isCorner(entry.move, size, depth)) score += 100000;
      else if (adjacentToCorner(entry.move, size, depth)) score -= 2500;
      if (preferredKey && moveKey(entry.move) === preferredKey) score += 50000;
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

function createSearchState(board, player, size, depth, directions, deadline) {
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
    cutoffs: 0
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
    entries, player, state.size, state.depth, cachedMove
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
  state.timedOut = false;
  state.deadline = deadline;
  const ordered = orderMoves(
    board, moves, player, size, depth, directions, previousBest ? moveKey(previousBest) : null
  );

  for (const entry of ordered) {
    if (performance.now() >= deadline) {
      state.timedOut = true;
      break;
    }
    const next = applyMove(board, entry.move, player, entry.flips);
    const nextHash = hashAfterMove(rootHash, entry.move, entry.flips, player, size, depth);
    const score = -searchNode(state, next, opponent(player), maxDepth - 1, -INF, INF, true, nextHash);
    if (state.timedOut) break;
    if (score > bestScore) {
      bestScore = score;
      bestMove = entry.move;
    }
  }

  return { move: bestMove, score: bestScore, completed: !state.timedOut };
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

  // Version 1.28.22: established Classic openings are consulted before search.
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

  // Iterative deepening reuses one search state and transposition table across
  // completed iterations. Deeper searches can therefore reuse earlier work and
  // the stored principal move can improve move ordering.
  const searchState = createSearchState(
    board, player, size, depth, directions, deadline
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
    bookPly: 0
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
