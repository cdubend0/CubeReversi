/*
 * Cube Reversi — Bot Engine (version 2.0.9)
 *
 * The Bot Engine remains a move-selection layer only. CubeReversi.js remains
 * authoritative for game state, rules, legal moves, rendering, turn management,
 * and actually committing moves.
 *
 */

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const INF = 1e15;

// The search is intentionally time-limited so the same engine can serve the
// 8×8×1 Classic board and the much larger 3D boards without freezing the UI.
// Difficulty profiles are deliberately conservative in this first pass.
// Easy uses a shallow search and a small amount of controlled variety. Medium
// uses the full medium search profile. Hard searches deeper and for longer.
const DIFFICULTY_PROFILES = {
  easy: { classicTimeMs: 120, threeDTimeMs: 90, randomness: 0.55 },
  medium: { classicTimeMs: 650, threeDTimeMs: 450, randomness: 0.0 },
  hard: { classicTimeMs: 5000, threeDTimeMs: 5000, randomness: 0.0 }
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
  // 2.0.9: name fixes only (bot move choices unchanged). The C2 E3 line is
  // Nicolet; Rose-Bill is the same line ending at C2 (weltyc / Edax). The old
  // "Leader's Tiger" entry repeated Stephenson's F6 moves and was removed; the
  // real Leader's Tiger (F5 D6 C3 D3 C4 F4 E6) is not added here because that
  // would give the bot a new opening move.
  { name: 'Rose-Bill', priority: 89, moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2' },
  { name: 'Nicolet', priority: 89, moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2 E3' },
  { name: 'Tamenori', priority: 88, moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2 E6' },
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
  // Standard Classic Reversi opening:
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

function chooseClassicBookMove(board, player, legalMoveOptions, allowVariety = false) {
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

  // 1.34.0: Medium picks among all established book continuations for light
  // opening variety. Hard keeps the deterministic strongest-priority choice.
  const selected = allowVariety && candidates.length > 1
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : candidates[0];
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

// -----------------------------------------------------------------------------
// 1.35.0 — Cube Opening Book (4×4×4, 6×6×6, 8×8×8)
// -----------------------------------------------------------------------------
// No published opening book exists for cubic Reversi with this starting
// position, so this one was generated with the 1.34.1 engine (about 10 s of
// search per position on 4×4×4 and 20 s on the larger cubes, see
// OPENING_BOOK_1.35.1.md). It works like the Classic book: positions are
// recognised up to symmetry, the bot plays book moves instantly, and named
// positions are shown in the corner when "Name Openings" is on.
//
// Symmetry: the start position (a 2×2×2 checkerboard block in the centre) is
// kept by 24 of the cube's 48 symmetries — the signed axis permutations with
// an even number of axis flips (12 rotations + 12 mirror symmetries). The
// other 24 turn the start block into its colour-swapped image. Book keys are
// "side to move / opponent" patterns, so those 24 combined with a colour swap
// are used too: all 48 transforms are tried and the smallest key wins.
//
// Storage: per board size, a pre-order tree. Each node is a move (one
// base-64 character per cell index on 4×4×4, two on the larger cubes), then
// its book score (engine units, from the mover's point of view), then its
// children in parentheses. Moves are stored in one fixed orientation; at load
// time every position is reduced to its canonical form.
//
// 2.0.8: on 4×4×4 the cell characters '0'-'9' (cells 52-61) could not be told
// apart from the digits of the score before them, so 64 entries were read
// with wrong scores and their following siblings or subtrees were lost (125
// of 963 book moves). A '.' now ends any score that a digit cell follows.
// Also 2.0.8: Snake Eyes - Möbius Strip, after A-4-S A-4-V Black's book
// reply is C-1-T (score 170). The engine's earlier picks there (B-1-T,
// A-4-U, A-3-V, all 150) lost most games; C-1-T was found by playing out
// every Black reply against Medium.
const CUBE_BOOK_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CUBE_BOOK_LETTERS_X = 'ABCDEFGH';
const CUBE_BOOK_LETTERS_Z = 'STUVWXYZ';

const CUBE_OPENING_BOOK = {
  4: {
    names: [
      {"family":"Vertex Opening","variation":"","moves":"A-1-V"},
      {"family":"Snake Eyes","variation":"","moves":"A-1-V A-1-S"},
      {"family":"Snake Eyes","variation":"Rubik's Line","moves":"A-1-V A-1-S B-2-S"},
      {"family":"Snake Eyes","variation":"Boxcars","moves":"A-1-V A-1-S B-2-S A-4-V"},
      {"family":"Snake Eyes","variation":"Möbius Strip","moves":"A-1-V A-1-S B-2-S A-2-T"},
      {"family":"Snake Eyes","variation":"Menger Sponge","moves":"A-1-V A-1-S B-2-S A-4-V B-4-U A-2-T B-1-T"},
      {"family":"Snake Eyes","variation":"Hypercube","moves":"A-1-V A-1-S B-2-S A-4-V B-4-U A-2-T B-1-T A-3-U A-4-U C-1-U D-1-V"},
      {"family":"Snake Eyes","variation":"Trinity","moves":"A-1-V A-1-S A-4-S"},
      {"family":"Snake Eyes","variation":"Octahedron","moves":"A-1-V A-1-S A-2-S"},
      {"family":"Snake Eyes","variation":"Dodecahedron","moves":"A-1-V A-1-S A-1-T"},
      {"family":"Edge Walker","variation":"","moves":"A-1-V A-1-U"},
      {"family":"Edge Walker","variation":"Far Corner","moves":"A-1-V A-1-U D-4-V"},
      {"family":"Edge Walker","variation":"Tightrope","moves":"A-1-V A-1-U A-4-S"},
      {"family":"Wormhole","variation":"","moves":"A-1-V A-2-T"},
      {"family":"Wormhole","variation":"Singularity","moves":"A-1-V A-2-T D-1-S"},
      {"family":"Wormhole","variation":"Tidal Lock","moves":"A-1-V A-2-T D-1-S D-1-V"},
      {"family":"Black Hole","variation":"","moves":"A-1-V C-3-S"},
      {"family":"Black Hole","variation":"Accretion Disc","moves":"A-1-V C-3-S A-4-S"},
      {"family":"Black Hole","variation":"Gravity Well","moves":"A-1-V C-3-S D-4-V"},
      {"family":"Facet Opening","variation":"","moves":"A-2-U"},
      {"family":"Stolen Vertex","variation":"","moves":"A-2-U A-1-S"},
      {"family":"Stolen Vertex","variation":"Euclid","moves":"A-2-U A-1-S D-1-S"},
      {"family":"Stolen Vertex","variation":"Archimedes","moves":"A-2-U A-1-S A-4-S"},
      {"family":"Stolen Vertex","variation":"Pythagoras","moves":"A-2-U A-1-S A-1-T"},
      {"family":"Antipodes","variation":"","moves":"A-2-U D-1-V"},
      {"family":"Antipodes","variation":"Equator","moves":"A-2-U D-1-V D-1-S"},
      {"family":"Antipodes","variation":"Meridian","moves":"A-2-U D-1-V C-1-V"},
      {"family":"Tesseract","variation":"","moves":"A-2-U D-3-T"},
      {"family":"Tesseract","variation":"Unfolded","moves":"A-2-U D-3-T A-4-S"},
      {"family":"Escher Stairs","variation":"","moves":"A-2-U A-2-T"},
      {"family":"Escher Stairs","variation":"Waterfall","moves":"A-2-U A-2-T D-1-S"},
      {"family":"Quasar","variation":"","moves":"A-2-U C-3-S"},
      {"family":"Quasar","variation":"Jet","moves":"A-2-U C-3-S D-1-S"},
      {"family":"Kepler","variation":"","moves":"A-2-U B-1-T"},
      {"family":"Kepler","variation":"Ellipse","moves":"A-2-U B-1-T C-2-S"},
      {"family":"Pulsar","variation":"","moves":"A-2-U A-1-U"},
      {"family":"Pulsar","variation":"Lighthouse","moves":"A-2-U A-1-U A-1-V"},
      {"family":"Orbit","variation":"","moves":"A-2-U C-1-U"},
      {"family":"Orbit","variation":"Slingshot","moves":"A-2-U C-1-U D-4-V"},
      {"family":"Platonic Defence","variation":"","moves":"A-2-U B-1-V"},
      {"family":"Platonic Defence","variation":"Icosahedron","moves":"A-2-U B-1-V A-1-V"}
    ],
    tree:
      '(D-220(A220(U212(P240(e-217(F-267(R267(K167(O-108(i108(z351(853.253n46g7.7-3))C107n102g92v83)b-146(g' +
      '-341i-346C-358)L-238)v108(f297(K31i-12n-15H-36C-48)O297b280_181)H96C72i53)E262(K174(b-116O-182)v169C' +
      '123n111H79)B127)C-365i-392)M-262O-316)F207(M209(P-150(h170R150(Q-107)O150L150b140e140))E204(P217(e26' +
      '2M115)z198R173T81C80)w176(z-148(n148(3305i305)y141.2134j102B75))Q84B75))M190(P-162(B-247(Q247(e130(K' +
      '292(b109(f302C302N204I194H188)U105L82R74O66)C274f264N207X193)b129(K308f298d276C266N200)U90(C250F250Y' +
      '215I141N140)O56R46)F247(J160(K292Y265C265d257S250)e138b138U136R115)C207(X162(F313Q304S196Y186)T122b1' +
      '11_94f94)Y134I123)R-262(Q262(O130(N298(d166(f272F135)Y135c72J30E23)f264K248X248H165)L130(H315f298K29' +
      '8d268X185)U119(F250S164H122C115)b114(f246K243d198H154N123)e105)F247Y113)))E181(P282(M136O-10)F175z13' +
      '4)B181(P282(M-247O-331)F240(M175(P-160)w175(z291i188)E113U75Q62)C206))C-136(_126(P-126(M103(8-103(X5' +
      '44(H-162(T604(J-232Y-232.6-255r-256N-256)G542o487L476B476)--164.6-183J-191r-195)b455G451.5441K439)Y-' +
      '201c-215--220.6-241)K-31)8-126(M492(P-544N-683)B492(P-438--438)X482(P-80--161H-178v-180r-181)o454(P-' +
      '95--144t-160v-173)G408)--190v-214)M126(A-189(w252(8-252(H314(J-314d-314.1-314g-314I-314)B204G174)I-2' +
      '55c-258d-305))P-229(_492b445f385)I-230(X642(H-234A-234z-234P-245T-306)w616S540_494G494)c-251N-271))F' +
      '-146(w135(z-452(n452(3-64(2374(i-33(j335(147T26X-40C-67g-93)y272-247v247e247)C-128g-128.1-150X-181)j' +
      '374(130i-27T-32C-74g-90)y368(i-33X-39x-61g-120C-122)v292-292)i-64(2374(3-335)j374y368-280v280)1-154g' +
      '-213)2397(3-64(n374y331j325v289-289)i-64n-135X-161)y397(n-20(H343(3111k111i76)S341G313v257u252)3-59x' +
      '-59i-60X-76)j349r303)3-492(r492(_-155(v419(7-58n-58u-153d-161x-186)-419.6419)7-155u-155d-228X-239)v4' +
      '92(_-155u-230.7-244d-256n-289)6492(_-155.7-155u-155d-227.1-240)-492(_-155u-230.7-244d-257X-269)n452)' +
      ')Q28)o-554(M567(P-567(_559(K-559(I1089(J-592(c1079(i-676Y-677N-683v-739.6-750)d1079)Y-592N-644.6-687' +
      'v-687)c1089(J-592Y-592N-644.6-687v-687)d1082(J-592Y-592N-619v-654r-659))J-572(c1089(K-592Y-599N-644H' +
      '-682.6-687)I1089d1082)Y-572(c1089(K-592J-599N-644.6-687v-687)I1089d1082)v-637.6-639))N-618(_1096(P-6' +
      '80(I1089(K-644Y-652J-705r-731.6-734)c1089d1089O1009)r-760)d972)A-678J-678I-678)_567(P-567(M1050)v-61' +
      '5(M1096(P-637J-758)u962)r-637H-677)))G-438(A438(w-46(z-42(k42(E-46(B46(R352(U73(0341g335.5295o260x24' +
      '2)Q63F6j-37n-57)x264g220C219s219)Q46(g431R431o301s291.5284)F16(R284x229H224s219o219)U16(g297R284.526' +
      '0o250s239)2-70)R-46(B46(E352.5238C219s219o215)Q46F16U16.2-61))B-7(k354(149(E363R352x280o251s250)017h' +
      '-15)E307R307x291g273)U-10(k347(010(E332R332s201o189)2-26.1-45h-84)E321R321o289s266)F-18(k317(149(R35' +
      '2E352s269o251x248)017h-1)E307R307o256s252)n-61))M-90(P71(R-449(Q449(B-71(Y433F432S432N385C348)U-71E-' +
      '84e-101b-112)F449)B-449(Q449F449N353C342Y316)U-449(Q449F449Y304)E-496(Q496F496I442)))B-90(P478(M-71d' +
      '-194)F478(M-71(P71)w-93E-145U-199k-206)z398R398)U-117Q-166)z438(w-46(R198(n238(3183(j213(7232T204g17' +
      '6.1176x106)2197)7183i118X37)j238(3183.7183g164.1128x71)2238(3183.7183.169i35))x141(_302(P37v-35u-35.' +
      '7-35)y299)g139(_255(P81v58u-23.7-35)j193.2161.0146.1146)k125E83)j-60(A478(k-411(R411i404T376K303C297' +
      ')w-474)i471(w89))2-86(A38(U-38(i395R395o313.5279b261)k-57w-77.0-124h-125)i-89)y-166.0-187)5134(w279(' +
      'A68(s340(142(x384(X24R8g-27.3-68I-74)0371h304k277)d38R-2I-28i-46)8317(z154.146x29)M303(D98C98X92R66J' +
      '62)F216k205)z17(_43(k-43D-65h-107T-137x-144))D-34R-67)8279(A-317(w317k212)z-317(w317.2282j240y203))M' +
      '266(A113(w-98Q-245)D113(w303T296S283)J95(w303c283Y263.8260)C92(_376w334X281T281S270)))F115(w202(z152' +
      '(2154(3144(n203(i228H114g78)j149)i144.160H50g-6)n154(3144i144g48H47.18)j91E50y25)3149(E239(1113k89x3' +
      '7)k229B155n154.2154)i82)M196(P-241(b241(f142v142X60C53d15)L241e241O127)v-269(R269B269U269k261r247)f-' +
      '309)k72.053)o115(w382(A96(s407(135(x432(g-38i-67.3-94d-106)0426h366k305)i-12.3-51)M323.8286U286)z25D' +
      '25T-49)M267.8267_266)R112(k272(A-263(M-106(d-282(N282(X85.185b43.532I-9)J242O193)b-296X-395I-405)N-1' +
      '93O-193J-241)K-371C-410)M247(P-260(b260(f66K66X-5I-16d-33)L260e260O229)K-260(b260L260e260k243O211)f-' +
      '377N-409)w211Y126)C86(D330(P117(_307(z105(B312(u53.653S47.730v24)u246f235e224.2215)--35)B304(A141z10' +
      '5S72T4)M298(A118F41)f213O212)z-26A-26)w240_240M235)i75(_-10(P10(u347(O20(L330(b6K-17H-36.7-37T-115)K' +
      '330e319f200)b20K-16.5-97s-103)K308(O125b125u20)L305(u33O20b20K-7.7-28)e299(u33O20b20v-42.7-71))O10(u' +
      '347(P-330b-330)K347L347e299)b10(u347(P-330O-330)K347L347e318f198))w-147)T43(D367(A-340(w340(z83(j387' +
      '(393.11i-4X-28)k366U352n328.2321))k301(i135R123z122b29)M254j254Q220)z-340(w340(A-387)j322.2319y301))' +
      'w261M241)))'
  },
  6: {
    names: [
      {"family":"Satellite Opening","variation":"","moves":"B-3-V"},
      {"family":"Orion","variation":"","moves":"B-3-V C-2-U"},
      {"family":"Orion","variation":"Belt","moves":"B-3-V C-2-U B-3-T"},
      {"family":"Orion","variation":"Sword","moves":"B-3-V C-2-U D-2-U"},
      {"family":"Orion","variation":"Nebula","moves":"B-3-V C-2-U B-3-T E-4-U E-3-U"},
      {"family":"Orion","variation":"Hunter","moves":"B-3-V C-2-U B-3-T E-4-U E-3-U B-4-V C-5-V"},
      {"family":"Andromeda","variation":"","moves":"B-3-V E-4-U"},
      {"family":"Andromeda","variation":"Spiral","moves":"B-3-V E-4-U D-3-T"},
      {"family":"Pyramid","variation":"","moves":"B-3-V D-4-T"},
      {"family":"Pyramid","variation":"Apex","moves":"B-3-V D-4-T C-4-T"},
      {"family":"Prism","variation":"","moves":"B-3-V C-2-W"},
      {"family":"Prism","variation":"Refraction","moves":"B-3-V C-2-W C-2-V"},
      {"family":"Domino","variation":"","moves":"B-3-V B-3-U"},
      {"family":"Domino","variation":"Double Six","moves":"B-3-V B-3-U B-4-U"},
      {"family":"Tetrahedron","variation":"","moves":"B-3-V B-2-V"},
      {"family":"Meteor Strike","variation":"","moves":"B-3-V B-2-T"},
      {"family":"Comet Opening","variation":"","moves":"B-2-W"},
      {"family":"Halley","variation":"","moves":"B-2-W D-4-T"},
      {"family":"Halley","variation":"Perihelion","moves":"B-2-W D-4-T D-5-T"},
      {"family":"Shooting Star","variation":"","moves":"B-2-W B-2-V"},
      {"family":"Stardust","variation":"","moves":"B-2-W B-3-U"},
      {"family":"Supernova","variation":"","moves":"B-2-W B-2-T"}
    ],
    tree:
      '(Az-7(BQ24(Ax-9(Ck27(Ce-6(A524(Bj-2(A620B012As11Bq11BF10)CG-7Bh-10A--11CI-14)B022Bz22Be17B215)Cl-7(A' +
      'y24As21CI20CC15B213)Cd-10B5-10Cq-10)B_26(Bb-5(Ay24As24Cm23Be22A422)Bi-7B5-10Cq-10Ce-12)CG26At21Ay20)' +
      'B0-9(Ce28(Cl-3(CI20Bu20CG20B820A017)CC-4CH-4Cr-5Cd-8)A521CS20Bk19Bz17)BP-10CC-11BV-11)Ck11(B5-28(A52' +
      '8(CG-4(BR24Cj23CZ13BP13AJ11)Bj-5Bi-8Bk-8Bh-9)A628B027CY26Be26)Ce-29(A529A628Bz26B024B224)Cd-29Bb-32B' +
      'h-33)B_5(Bb-5(At0(Ck0(Cq12CG9Bi5Bh2A-1)BQ0BR0BS0B5-1)B8-1A4-1Ay-1B2-3)B5-7(Be28CY24B021BQ21BS20)Bi-1' +
      '1Ce-11Cq-12)BS2(BR-21(CG21(CH1(CC17Ay17Cm17As17B213)Cr1Ce-6Cq-6B5-7)B820A020Ay18At18)A4-26(Ck5BV4Ay4' +
      'Cf4AP2)Ce-26B5-26B0-27)Ay2(A4-2(A57(BQ-17(Bb17BP16Bz16BR11AJ7)AI-29B0-34CY-35As-39)Bk-1CI-2AQ-4BY-5)' +
      'As-4(BQ19B_18Ck18Be17CG17)CC-5Bh-5Cl-5)At-1(BR1(CG-7(Bi7(B813A412B212As7Ay6)Bh3CF1Bb-1Cd-5)Ay-7B_-8A' +
      '0-9Be-12)B0-1(Bj26Cd18BV16Cf16AP16)BY-2Bi-2A4-2)B1-4(A44(CF10(Cq12(CG4At4B_3Ax1Ay0)Cj11Ck11Cf10Cg9)C' +
      'G10B_9At8Ax7)CF4(Ax-8B_-8A_-9CG-10Ay-11)Bi0Ce0B00)AK-31(Cd39(At-39(BR35(B5-42CY-43Bz-44Be-46CH-48)A0' +
      '32BY31Bb28AQ28)BS-39Ck-41CY-41Be-42)B037(At-37Be-42Ck-42BS-42Bz-43)B537A432Ce32)Ca-143(B2263(Ay-281(' +
      'C5281(A5-265BY-267At-267B_-268Be-268)B5257Cd156B0155Cr150)B1-282At-283BQ-283B_-283)CZ261(BQ-280B_-28' +
      '0Ay-281At-282BS-285)Cf258Bh245A4244)Ar-262(BV260(A5-276(AA276(Ay-258CG-260B_-265BQ-265Ck-268)Bj154A_' +
      '129)CG-279Be-279Ck-283Aw-285)BP259(At-274BS-276B_-281A5-285CG-286)Ax259As256B5248))Au-247(B_57(CF-57' +
      '(Be256(B0-256(BQ257BS255BR254Cj254Ck254)A6-256Bh-256Bj-257A4-258)BQ254CG251Ck251BS251)Cq-157)At56(BY' +
      '-56(B_279CG195)Az-56)Ay50(CC-50(B8249Cq249A0248Be248CG242)A4-52Bb-54As-57B0-60)Ar-172(Cr172(BY22A018' +
      'CI10Cq5CG-2)CC150As110BV109Bb85)))'
  },
  8: {
    names: [
      {"family":"Quadrant Opening","variation":"","moves":"C-4-W"},
      {"family":"Skyscraper","variation":"","moves":"C-4-W F-5-V"},
      {"family":"Skyscraper","variation":"Elevator","moves":"C-4-W F-5-V F-5-U"},
      {"family":"Skyscraper","variation":"Fire Escape","moves":"C-4-W F-5-V F-3-U"},
      {"family":"Skyscraper","variation":"Penthouse","moves":"C-4-W F-5-V F-5-U E-3-W C-5-V E-6-U F-6-V"},
      {"family":"Cathedral","variation":"","moves":"C-4-W D-3-V"},
      {"family":"Cathedral","variation":"Nave","moves":"C-4-W D-3-V F-5-W"},
      {"family":"Tower","variation":"","moves":"C-4-W C-4-V"},
      {"family":"Tower","variation":"Spire","moves":"C-4-W C-4-V C-5-V"},
      {"family":"Pagoda","variation":"","moves":"C-4-W E-5-U"},
      {"family":"Pagoda","variation":"Roof","moves":"C-4-W E-5-U F-6-V"},
      {"family":"Labyrinth","variation":"","moves":"C-4-W C-3-W"},
      {"family":"Labyrinth","variation":"Minotaur","moves":"C-4-W C-3-W E-3-V"},
      {"family":"Bridge","variation":"","moves":"C-4-W C-3-U"},
      {"family":"Bridge","variation":"Arch","moves":"C-4-W C-3-U D-4-U"},
      {"family":"Colonnade","variation":"","moves":"C-4-W E-3-W"},
      {"family":"Ziggurat","variation":"","moves":"C-4-W D-3-X"},
      {"family":"Aqueduct","variation":"","moves":"C-4-W F-3-X"},
      {"family":"Folly","variation":"","moves":"C-4-W B-3-X"},
      {"family":"Lattice Opening","variation":"","moves":"C-3-X"},
      {"family":"Crystal","variation":"","moves":"C-3-X C-4-V"},
      {"family":"Crystal","variation":"Facet","moves":"C-3-X C-4-V D-5-U"},
      {"family":"Diamond","variation":"","moves":"C-3-X E-5-U"},
      {"family":"Diamond","variation":"Cut","moves":"C-3-X E-5-U D-5-U"},
      {"family":"Graphite","variation":"","moves":"C-3-X C-3-U"},
      {"family":"Graphite","variation":"Layer","moves":"C-3-X C-3-U D-4-U"},
      {"family":"Quartz","variation":"","moves":"C-3-X C-3-W"}
    ],
    tree:
      '(Cc-8(Fj8(Fi5(EU-5(Cj-7(Eq-2(Fr-6(Er-5Ck-6Cd-7Cq-9Ei-9)Fq-8Fb-10Fs-10Gj-11)Er-6Cs-12Cd-13Ei-13)ET-9(' +
      'Eq-9Ea-10Ei-14Ca-14Cs-14)El-9Eq-11Fc-12)Ed-5(Fb-8(Ea-7Eq-9Ei-9GS-12Ga-12)ET-9Cj-10Eq-11Fa-11)Ei-5Er-' +
      '5Cb-6)FS4(EU-4(Cr-7(Ea-6DT-8ET-10Cj-10Ca-11)Eq-8Er-9Ed-10Dq-14)EV-4ET-6DT-6FT-6)Fb4Fq2Cq1)DT8(Fk-8(F' +
      'r-4(Ei-9(Er-4Cd-8Dd-9Dl-9Ed-10)ES-10Da-12Fq-12CS-13)Er-6Dd-6Et-8Dt-9)Fs-9(Fr-7Et-7Dl-8Dd-8Dt-8)El-10' +
      'Ea-11Fa-12)Cb8(Cj-8(Dd-10(DU-5(Er-14Dr-15Ei-15Ci-16EU-17)DT-8Fk-12EV-13Fl-14)Ck-12CU-17Ct-17Dt-17)Da' +
      '-9(DT-8Ei-9Fj-10Dl-11Ck-13)El-10Fk-10DS-11)Ei7(Fr-7(Er-5(Eq-13(Ck-6Cd-8Gr-13EU-14CS-19)Fi-14Fq-14Di-' +
      '14Dq-18)Fj-5Dl-6DT-6Cd-6)Fb-8Dr-10Di-10FS-12)CU4(ET-4(Ds-11(Dt-4(Dl-11Fj-12DT-13EU-14ES-15)Es-4Cs-8C' +
      't-8Dr-8)Fc-12Da-13Fa-13Dl-17)Dd-5(Fj-8DT-11Er-12Cb-14Ei-15)DU-6Dr-6Fb-6)FV3(Cj19(Ci1(Di-1(Cp-18Eq-22' +
      'Ca-23Er-24Cs-27)Dq-1Eq-2Dr-2Fb-3)Cq-2Ca-3Eq-4CS-4)Eq16(Ca3Cq3Ci2Cb0Ei0)Di12Dq12EV11)DV3(CV9(EU-9(Fa-' +
      '4(Ei-11Ck-11Ea-15Cs-15Fj-15)Fb-4ET-7FS-7Dr-8)Ei-10Cb-14DT-16FV-17)ET9(Fa-9Da-9Fc-12EU-14Fq-15)Ea9DU8' +
      'FS6)EU3(Dr-3(Ca-13(ET0(Fb-15Dd-17Ea-17Ck-20Dt-21)Fs-1FT-3Fd-3CT-4)CS-14Cb-14Ck-15Er-17)Di-4(Cs-14Cb-' +
      '15Er-16Ct-17Ca-17)Cj-5Dq-6ET-7)CS3(Da-3(Dl-14(Fa-1(DU-14DS-17FT-17ES-18DT-18)Fb-2Ea-2ET-4Cs-6)Fj-17C' +
      'b-18Er-18Ck-18)Ea-5(DT5Dl-1CU-1Ck-1EU-5)CT-7Cj-7Di-8)BV-9(ET19(Ea-19(Di7(Dd-19Fb-21Dr-22Ck-23Dt-24)C' +
      'j6Fk6Es6Da4)Ei-19Es-22CU-22Fj-23)Cj18(Cb-5Ea-7CU-8Eq-9CS-9)Ea18Fa17Fb17))CV-10(Cb10(Fk-10Di-12(EU-3F' +
      'd-3Dd-5Dr-5CU-6)Da-12Es-12Fs-14)Ei8(Di6(Cj-6EV-9Cb-9CU-10Ed-10)Dr5Fr4Cq0Ft0)CS3(Da14(Cb8Dl4Er3CU1Cd-' +
      '1)CT13El6Ca5Di5)CU3(Dd9Cc7Dr4Cj3Cq2)))'
  },
};

// Book-move selection margins (engine score units). Hard always plays the
// best-scored book move; Medium and Easy choose among near-best book moves.
const CUBE_BOOK_MARGIN = { hard: 0, medium: 35, easy: 120 };

const cubeBookCache = new Map();

function cubeBookTransforms(size) {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const list = [];
  const n = size * size * size;
  for (const p of perms) {
    for (let s = 0; s < 8; s++) {
      const sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
      const map = new Int32Array(n);
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          for (let z = 0; z < size; z++) {
            const c = [x, y, z];
            const t = [0, 1, 2].map((k) => (sg[k] > 0 ? c[p[k]] : size - 1 - c[p[k]]));
            map[(x * size + y) * size + z] = (t[0] * size + t[1]) * size + t[2];
          }
        }
      }
      const inverse = new Int32Array(n);
      for (let i = 0; i < n; i++) inverse[map[i]] = i;
      list.push({ map, inverse, colourSwap: sg[0] * sg[1] * sg[2] < 0 });
    }
  }
  return list;
}

function cubeBookInitialBoard(size) {
  const board = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => new Array(size).fill(EMPTY)));
  const low = size / 2 - 1;
  const high = size / 2;
  const start = [
    [low, low, low, BLACK], [low, low, high, WHITE], [low, high, low, WHITE], [low, high, high, BLACK],
    [high, low, low, WHITE], [high, low, high, BLACK], [high, high, low, BLACK], [high, high, high, WHITE]
  ];
  for (const [x, y, z, v] of start) board[x][y][z] = v;
  return board;
}

// Canonical "mover / opponent" key over all 48 transforms.
function cubeBookCanonical(board, size, player, transforms) {
  const n = size * size * size;
  const cells = new Uint8Array(n);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const v = board[x][y][z];
        cells[(x * size + y) * size + z] = v === EMPTY ? 0 : (v === player ? 1 : 2);
      }
    }
  }
  let bestKey = null;
  let bestIndex = 0;
  const out = new Array(n);
  for (let t = 0; t < transforms.length; t++) {
    const map = transforms[t].map;
    for (let i = 0; i < n; i++) out[map[i]] = cells[i];
    const key = out.join('');
    if (bestKey === null || key < bestKey) {
      bestKey = key;
      bestIndex = t;
    }
  }
  return { key: bestKey, transform: bestIndex };
}

function cubeBookCellToMove(index, size) {
  return [Math.floor(index / (size * size)), Math.floor(index / size) % size, index % size];
}

function cubeBookNotation(move) {
  return `${CUBE_BOOK_LETTERS_X[move[0]]}-${move[1] + 1}-${CUBE_BOOK_LETTERS_Z[move[2]]}`;
}

function cubeBookParseNotation(token) {
  const m = /^([A-H])-(\d)-([S-Z])$/i.exec(String(token).replace(/\s+/g, ''));
  if (!m) return null;
  return [m[1].toUpperCase().charCodeAt(0) - 65, Number(m[2]) - 1, m[3].toUpperCase().charCodeAt(0) - 83];
}

// Apply one move on a plain nested board; returns false if it is not legal.
function cubeBookPlay(board, move, player, size, directions) {
  const flips = getFlips(board, move, player, size, size, directions);
  if (!flips.length || board[move[0]][move[1]][move[2]] !== EMPTY) return false;
  board[move[0]][move[1]][move[2]] = player;
  for (const [x, y, z] of flips) board[x][y][z] = player;
  return true;
}

function cubeBookHasMove(board, player, size, directions) {
  return legalMoves(board, player, size, size, directions).length > 0;
}

function buildCubeBook(size) {
  const data = CUBE_OPENING_BOOK[size];
  if (!data) return null;
  const transforms = cubeBookTransforms(size);
  const directions = buildDirections(size);
  const width = size === 4 ? 1 : 2;
  const moves = new Map(); // canonical key -> [{ cell (canonical index), score, name }]
  const names = new Map(); // canonical key -> { family, variation, ply }

  // Named positions first, so book entries can carry their line's name.
  for (const entry of data.names) {
    const board = cubeBookInitialBoard(size);
    let player = BLACK;
    let ok = true;
    const tokens = entry.moves.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const move = cubeBookParseNotation(token);
      if (!move || !cubeBookPlay(board, move, player, size, directions)) { ok = false; break; }
      player = opponent(player);
      if (!cubeBookHasMove(board, player, size, directions)) player = opponent(player);
    }
    if (!ok) continue;
    const c = cubeBookCanonical(board, size, player, transforms);
    if (!names.has(c.key)) {
      names.set(c.key, { family: entry.family, variation: entry.variation || '', ply: tokens.length });
    }
  }

  // Walk the stored tree.
  const text = data.tree;
  let pos = 0;
  const readCell = () => {
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 64 + CUBE_BOOK_ALPHABET.indexOf(text[pos++]);
    return v;
  };
  const readScore = () => {
    const m = /^-?\d+/.exec(text.slice(pos, pos + 12));
    pos += m[0].length;
    // 2.0.8: a '.' ends a score that is followed by a digit cell character.
    if (text[pos] === '.') pos++;
    return Number(m[0]);
  };
  const walk = (board, player, inheritedName) => {
    // Called with pos at '(' ; reads children until the matching ')'.
    pos++;
    const parent = cubeBookCanonical(board, size, player, transforms);
    const list = moves.get(parent.key) || [];
    const inverse = transforms[parent.transform].map;
    while (text[pos] !== ')') {
      const cell = readCell();
      const score = readScore();
      const move = cubeBookCellToMove(cell, size);
      const next = board.map((plane) => plane.map((row) => row.slice()));
      if (!cubeBookPlay(next, move, player, size, directions)) {
        // Corrupt entry: skip its subtree.
        if (text[pos] === '(') { let d = 0; do { if (text[pos] === '(') d++; else if (text[pos] === ')') d--; pos++; } while (d > 0); }
        continue;
      }
      let nextPlayer = opponent(player);
      if (!cubeBookHasMove(next, nextPlayer, size, directions)) nextPlayer = opponent(nextPlayer);
      const childKey = cubeBookCanonical(next, size, nextPlayer, transforms).key;
      const named = names.get(childKey);
      const label = named ? named : inheritedName;
      const canonicalCell = inverse[cell];
      if (!list.some((e) => e.cell === canonicalCell)) list.push({ cell: canonicalCell, score, name: label });
      if (text[pos] === '(') walk(next, nextPlayer, label);
    }
    pos++;
    list.sort((a, b) => b.score - a.score);
    moves.set(parent.key, list);
  };
  if (text[pos] === '(') walk(cubeBookInitialBoard(size), BLACK, null);
  return { size, transforms, directions, moves, names };
}

function getCubeBook(size) {
  if (!cubeBookCache.has(size)) {
    let book = null;
    try { book = buildCubeBook(size); } catch (error) { book = null; }
    cubeBookCache.set(size, book);
  }
  return cubeBookCache.get(size);
}

function cubeBookLabel(named) {
  if (!named) return '';
  return named.variation ? `${named.family} - ${named.variation}` : named.family;
}

function chooseCubeBookMove(board, size, player, moveOptions, difficulty) {
  const book = getCubeBook(size);
  if (!book) return null;
  const c = cubeBookCanonical(board, size, player, book.transforms);
  const entries = book.moves.get(c.key);
  if (!entries || !entries.length) return null;
  const inverse = book.transforms[c.transform].inverse;
  const legal = new Set(moveOptions.map((option) => moveKey(option.move)));
  const candidates = entries
    .map((entry) => ({ ...entry, move: cubeBookCellToMove(inverse[entry.cell], size) }))
    .filter((entry) => legal.has(moveKey(entry.move)));
  if (!candidates.length) return null;
  const best = candidates[0].score;
  const margin = CUBE_BOOK_MARGIN[difficulty] ?? CUBE_BOOK_MARGIN.medium;
  const pool = candidates.filter((entry) => entry.score >= best - margin);
  const pick = pool.length > 1 ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
  return { move: pick.move, name: cubeBookLabel(pick.name), score: pick.score, candidates: candidates.length };
}

// Opening name for a game history (array of notation strings, PASS etc.).
// Returns { family, variation, ply } for the deepest named position reached,
// or null. Rotated / mirrored / colour-swapped transpositions share a name.
export function recognizeCubeOpening(history, size) {
  if (!Array.isArray(history) || !CUBE_OPENING_BOOK[size]) return null;
  const book = getCubeBook(size);
  if (!book) return null;
  const board = cubeBookInitialBoard(size);
  let player = BLACK;
  let found = null;
  let ply = 0;
  for (const token of history) {
    if (token === 'PASS') { player = opponent(player); continue; }
    const move = cubeBookParseNotation(token);
    if (!move) continue;
    if (!cubeBookPlay(board, move, player, size, book.directions)) break;
    ply++;
    player = opponent(player);
    if (!cubeBookHasMove(board, player, size, book.directions)) {
      if (!cubeBookHasMove(board, opponent(player), size, book.directions)) break;
      player = opponent(player);
    }
    const named = book.names.get(cubeBookCanonical(board, size, player, book.transforms).key);
    if (named) found = { ...named, ply };
    // Book names stop well before move 24; no need to keep replaying.
    if (ply > 24) break;
  }
  return found;
}


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
function cubeCornerRiskScore(board, player, size, depth) {
  const other = opponent(player);
  let score = 0;

  // A cube corner is valuable in every board geometry. For 3D boards, use the
  // three face-adjacent cells leading directly into each corner as a modest
  // structural warning rather than applying Classic 8x8 X/C-square patterns.
  for (const [cx, cy, cz] of cornerMoves(size, depth)) {
    if (board[cx][cy][cz] !== EMPTY) continue;

    const inward = [
      [cx === 0 ? 1 : -1, 0, 0],
      [0, cy === 0 ? 1 : -1, 0],
      [0, 0, depth === 1 ? 0 : (cz === 0 ? 1 : -1)]
    ];

    for (const [dx, dy, dz] of inward) {
      if (dx === 0 && dy === 0 && dz === 0) continue;
      const x = cx + dx;
      const y = cy + dy;
      const z = cz + dz;
      if (!inside(x, y, z, size, depth)) continue;
      if (board[x][y][z] === player) score -= 2;
      else if (board[x][y][z] === other) score += 2;
    }
  }

  return score;
}

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
  const ownLegalCorners = legalMoves(board, player, size, depth, directions)
    .filter((move) => isCorner(move, size, depth)).length;
  const otherLegalCorners = legalMoves(board, other, size, depth, directions)
    .filter((move) => isCorner(move, size, depth)).length;
  cornerAccessScore = ownLegalCorners - otherLegalCorners;

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
  const cornerRiskWeight = endgame ? 9 : 14;
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
    patterns: patternWeight * (depth === 1 && size === 8
      ? classicCornerPatternScore(board, player) + classicDiagonalPatternScore(board, player)
      : 0),
    cornerPattern5x2: cornerPattern5x2Weight * (depth === 1 && size === 8
      ? classicCorner5x2PatternScore(board, player)
      : 0),
    cornerRisk: cornerRiskWeight * (depth === 1 && size === 8
      ? classicCornerRiskScore(board, player, directions)
      : cubeCornerRiskScore(board, player, size, depth)),
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

// ===========================================================================
// 1.34.0 — dedicated 3D engine (4×4×4, 6×6×6, 8×8×8)
// 1.34.1 — faster move generation and evaluation on 6×6×6/8×8×8 (incremental
// neighbour counts and empty list), solver ordering by isolation, realistic
// solve thresholds and size-specific evaluation weights for the larger cubes.
// ---------------------------------------------------------------------------
// The Classic 8×8×1 path above is untouched. 3D boards use a flat Int8Array
// board with precomputed 26-direction rays, make/unmake instead of cloning,
// a typed-array transposition table, 64-bit bitboards (two 32-bit halves) for
// 4×4×4 move generation, a 3D-specific evaluation, phase-based time
// allocation and an exact endgame solver.
// ===========================================================================
const CUBE_ENGINE_VERSION = '2.0.9';
const CUBE_DIRS = (() => {
  const dirs = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx || dy || dz) dirs.push([dx, dy, dz]);
      }
    }
  }
  return dirs;
})();
const CUBE_OPPOSITE = CUBE_DIRS.map(([a, b, c]) =>
  CUBE_DIRS.findIndex(([x, y, z]) => x === -a && y === -b && z === -c));
// 13 line axes (one direction of each opposite pair).
const CUBE_AXES = CUBE_DIRS.map((_, i) => i).filter((i) => {
  const [a, b, c] = CUBE_DIRS[i];
  return a > 0 || (a === 0 && (b > 0 || (b === 0 && c > 0)));
});
const CUBE_WIN = 1000000;
// 2.0.7: Hard's minimum-depth floor may run past its budget, up to this.
const HARD_FLOOR_BUDGET_FACTOR = 5;
const HARD_FLOOR_MAX_MS = 10000;
const CUBE_INF = 1 << 30;
const cubeGeometryCache = new Map();

// Tunable evaluation weights (score points; ratio terms use a ±100 scale).
const CUBE_WEIGHTS = {
  corner: 300,
  stable: 40,
  ownCornerAccess: 140,
  oppCornerAccess: 240,
  lineRisk: 28,
  mobilityDiff: 7,
  mobilityRatio: 1.2,
  potential: 0.6,
  frontier: 0.6,
  discEarly: -0.5,
  discMid: 1.5,
  discLate: 8,
  parity: 45,
  regionParity: 30,
  pass: 140,
  tempo: 0,
  // Larger cubes only: endgame-solver move ordering prefers moves with few
  // empty neighbours (isolated regions), which roughly halves solver nodes.
  solveIsolation: 2
};

// 1.34.1: evaluation weights for the larger cubes. Same as the 4×4×4 weights
// except where self-play on those boards showed a gain: move counts there are
// several times larger, so the raw mobility difference is weighted much less
// (the mobility ratio term is unchanged); 6×6×6 also rewards a small frontier.
const CUBE_SIZE_OVERRIDES = {
  6: { mobilityDiff: 0.5, frontier: 2 },
  8: { mobilityDiff: 1.5 }
};
const CUBE_WEIGHTS_BY_SIZE = {
  6: { ...CUBE_WEIGHTS, ...CUBE_SIZE_OVERRIDES[6] },
  8: { ...CUBE_WEIGHTS, ...CUBE_SIZE_OVERRIDES[8] }
};

// Keys may be prefixed with "6." or "8." to change one larger-cube size only.
export function configureCubeEngine(overrides = {}) {
  for (const [key, value] of Object.entries(overrides)) {
    if (!Number.isFinite(value)) continue;
    const m = /^(6|8)\.(.+)$/.exec(key);
    if (m) {
      if (m[2] in CUBE_WEIGHTS) CUBE_WEIGHTS_BY_SIZE[m[1]][m[2]] = value;
    } else if (key in CUBE_WEIGHTS) {
      CUBE_WEIGHTS[key] = value;
      for (const sz of [6, 8]) {
        if (!(key in CUBE_SIZE_OVERRIDES[sz])) CUBE_WEIGHTS_BY_SIZE[sz][key] = value;
      }
    }
  }
  return { ...CUBE_WEIGHTS };
}

function popcount32(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function getCubeGeometry(size) {
  let g = cubeGeometryCache.get(size);
  if (g) return g;
  const n = size * size * size;
  const coord = new Int8Array(n * 3);
  for (let i = 0; i < n; i++) {
    coord[i * 3] = Math.floor(i / (size * size));
    coord[i * 3 + 1] = Math.floor(i / size) % size;
    coord[i * 3 + 2] = i % size;
  }
  const rayStart = new Int32Array(n * 26);
  const rayLen = new Uint8Array(n * 26);
  const rayList = [];
  const nbList = [];
  const nbStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    nbStart[i] = nbList.length;
    const x0 = coord[i * 3], y0 = coord[i * 3 + 1], z0 = coord[i * 3 + 2];
    for (let d = 0; d < 26; d++) {
      const [dx, dy, dz] = CUBE_DIRS[d];
      rayStart[i * 26 + d] = rayList.length;
      let x = x0 + dx, y = y0 + dy, z = z0 + dz, len = 0;
      while (x >= 0 && y >= 0 && z >= 0 && x < size && y < size && z < size) {
        rayList.push((x * size + y) * size + z);
        len++;
        x += dx; y += dy; z += dz;
      }
      rayLen[i * 26 + d] = len;
      if (len) nbList.push(rayList[rayStart[i * 26 + d]]);
    }
  }
  nbStart[n] = nbList.length;
  const deg = new Uint8Array(n);
  const cellClass = new Uint8Array(n); // boundary coordinates: 0 interior, 1 face, 2 edge, 3 corner
  for (let i = 0; i < n; i++) {
    deg[i] = nbStart[i + 1] - nbStart[i];
    let b = 0;
    for (let a = 0; a < 3; a++) if (coord[i * 3 + a] === 0 || coord[i * 3 + a] === size - 1) b++;
    cellClass[i] = b;
  }
  const corners = [];
  const isCornerCell = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const onEdge = (v) => v === 0 || v === size - 1;
    if (onEdge(coord[i * 3]) && onEdge(coord[i * 3 + 1]) && onEdge(coord[i * 3 + 2])) {
      corners.push(i);
      isCornerCell[i] = 1;
    }
  }
  // Inward directions (the 7 lines) for each corner.
  const cornerDirs = corners.map((c) => {
    const list = [];
    for (let d = 0; d < 26; d++) if (rayLen[c * 26 + d] > 0) list.push(d);
    return list;
  });
  let seed = 0x2545f491;
  const rnd = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed | 0;
  };
  const z1 = new Int32Array(n * 3);
  const z2 = new Int32Array(n * 3);
  for (let i = 0; i < n * 3; i++) { z1[i] = rnd(); z2[i] = rnd(); }
  g = {
    size, n, coord, rayStart, rayLen,
    rayCells: Int16Array.from(rayList),
    nbStart, nbCells: Int16Array.from(nbList), deg, cellClass,
    corners: Int16Array.from(corners), isCornerCell, cornerDirs,
    z1, z2, side1: rnd(), side2: rnd(),
    bitboard: size === 4
  };
  if (size === 4) {
    g.dirShift = new Int8Array(26);
    g.srcLo = new Int32Array(26);
    g.srcHi = new Int32Array(26);
    for (let d = 0; d < 26; d++) {
      const [dx, dy, dz] = CUBE_DIRS[d];
      g.dirShift[d] = dx * 16 + dy * 4 + dz;
      let lo = 0, hi = 0;
      for (let i = 0; i < 64; i++) {
        if (rayLen[i * 26 + d] > 0) {
          if (i < 32) lo |= (1 << i); else hi |= (1 << (i - 32));
        }
      }
      g.srcLo[d] = lo;
      g.srcHi[d] = hi;
    }
  }
  cubeGeometryCache.set(size, g);
  return g;
}

// ---- 64-bit bitboard helpers for 4×4×4 (two signed 32-bit halves) ----------
let bbOutLo = 0;
let bbOutHi = 0;
function bbShift(lo, hi, s) {
  if (s > 0) {
    bbOutLo = lo << s;
    bbOutHi = (hi << s) | (lo >>> (32 - s));
  } else {
    const r = -s;
    bbOutLo = (lo >>> r) | (hi << (32 - r));
    bbOutHi = hi >>> r;
  }
}

function bbMoves(g, pLo, pHi, oLo, oHi) {
  const eLo = ~(pLo | oLo);
  const eHi = ~(pHi | oHi);
  let mLo = 0, mHi = 0;
  const shifts = g.dirShift, srcLo = g.srcLo, srcHi = g.srcHi;
  for (let d = 0; d < 26; d++) {
    const s = shifts[d], sl = srcLo[d], sh = srcHi[d];
    bbShift(pLo & sl, pHi & sh, s);
    let tLo = bbOutLo & oLo, tHi = bbOutHi & oHi;
    if (!(tLo | tHi)) continue;
    bbShift(tLo & sl, tHi & sh, s);
    tLo |= bbOutLo & oLo; tHi |= bbOutHi & oHi;
    bbShift(tLo & sl, tHi & sh, s);
    mLo |= bbOutLo & eLo; mHi |= bbOutHi & eHi;
  }
  bbOutLo = mLo;
  bbOutHi = mHi;
}

function bbDilate(g, lo, hi) {
  let rLo = 0, rHi = 0;
  for (let d = 0; d < 26; d++) {
    bbShift(lo & g.srcLo[d], hi & g.srcHi[d], g.dirShift[d]);
    rLo |= bbOutLo; rHi |= bbOutHi;
  }
  bbOutLo = rLo;
  bbOutHi = rHi;
}

// ---- Board state with make/unmake ----------------------------------------
function createCubeState(board, size) {
  const g = getCubeGeometry(size);
  const n = g.n;
  const st = {
    g, size, n,
    cells: new Int8Array(n),
    count: new Int32Array(3),
    h1: 0, h2: 0,
    bb: new Int32Array(4),
    flipStack: new Int16Array(Math.max(4096, n * 48)),
    sp: 0,
    moveLists: [],
    orderScores: [],
    nodes: 0, leaves: 0, cutoffs: 0, ttStores: 0,
    solveNodes: 0,
    deadline: Infinity,
    timedOut: false,
    killers: null,
    history: new Int32Array(3 * n),
    scratch: new Uint8Array(n),
    queue: new Int16Array(n),
    // Incremental structures for the larger (non-bitboard) cubes: neighbour
    // colour counts per cell and a LIFO-restorable list of empty cells.
    nbc: null,
    trackNb: true, // false inside the exact solver (no evaluation needed there)
    elist: null,
    epos: null,
    ecount: 0
  };
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const v = board[x][y][z];
        if (v !== BLACK && v !== WHITE) continue;
        const i = (x * size + y) * size + z;
        st.cells[i] = v;
        st.count[v]++;
        st.h1 ^= g.z1[i * 3 + v];
        st.h2 ^= g.z2[i * 3 + v];
        if (g.bitboard) cubeToggleBit(st, v, i);
      }
    }
  }
  st.killers = new Int16Array(2 * (2 * n + 8)).fill(-1);
  if (!g.bitboard) {
    st.nbc = new Uint8Array(3 * n);
    st.elist = new Int16Array(n);
    st.epos = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = st.cells[i];
      if (v === EMPTY) {
        st.epos[i] = st.ecount;
        st.elist[st.ecount++] = i;
        continue;
      }
      for (let j = g.nbStart[i], e = g.nbStart[i + 1]; j < e; j++) st.nbc[v * n + g.nbCells[j]]++;
    }
  }
  return st;
}

function cubeToggleBit(st, color, i) {
  const k = (color - 1) * 2;
  if (i < 32) st.bb[k] ^= (1 << i);
  else st.bb[k + 1] ^= (1 << (i - 32));
}

function cubeNbShift(st, c, from, to) {
  const g = st.g, nbc = st.nbc, n = st.n, offF = from * n, offT = to * n;
  for (let j = g.nbStart[c], e = g.nbStart[c + 1]; j < e; j++) {
    const q = g.nbCells[j];
    nbc[offF + q]--;
    nbc[offT + q]++;
  }
}

function cubeMakeMove(st, m, color) {
  const g = st.g, cells = st.cells, other = 3 - color;
  const base = m * 26;
  const z1 = g.z1, z2 = g.z2;
  let flipped = 0;
  for (let d = 0; d < 26; d++) {
    const len = g.rayLen[base + d];
    if (len < 2) continue;
    const s = g.rayStart[base + d];
    let k = 0;
    while (k < len && cells[g.rayCells[s + k]] === other) k++;
    if (k === 0 || k === len || cells[g.rayCells[s + k]] !== color) continue;
    for (let j = 0; j < k; j++) {
      const c = g.rayCells[s + j];
      cells[c] = color;
      st.flipStack[st.sp++] = c;
      st.h1 ^= z1[c * 3 + other] ^ z1[c * 3 + color];
      st.h2 ^= z2[c * 3 + other] ^ z2[c * 3 + color];
      if (g.bitboard) { cubeToggleBit(st, other, c); cubeToggleBit(st, color, c); }
      else if (st.trackNb) cubeNbShift(st, c, other, color);
    }
    flipped += k;
  }
  cells[m] = color;
  st.h1 ^= z1[m * 3 + color];
  st.h2 ^= z2[m * 3 + color];
  if (g.bitboard) cubeToggleBit(st, color, m);
  else {
    if (st.trackNb) {
      const nbc = st.nbc, off = color * st.n;
      for (let j = g.nbStart[m], e = g.nbStart[m + 1]; j < e; j++) nbc[off + g.nbCells[j]]++;
    }
    // Swap m to the end of the empty list; undo restores it by ecount++.
    const pos = st.epos[m], last = st.elist[--st.ecount];
    st.elist[pos] = last; st.epos[last] = pos;
    st.elist[st.ecount] = m; st.epos[m] = st.ecount;
  }
  st.count[color] += flipped + 1;
  st.count[other] -= flipped;
  return flipped;
}

function cubeUndoMove(st, m, color, flipped) {
  const g = st.g, cells = st.cells, other = 3 - color;
  const z1 = g.z1, z2 = g.z2;
  for (let j = 0; j < flipped; j++) {
    const c = st.flipStack[--st.sp];
    cells[c] = other;
    st.h1 ^= z1[c * 3 + other] ^ z1[c * 3 + color];
    st.h2 ^= z2[c * 3 + other] ^ z2[c * 3 + color];
    if (g.bitboard) { cubeToggleBit(st, other, c); cubeToggleBit(st, color, c); }
    else if (st.trackNb) cubeNbShift(st, c, color, other);
  }
  cells[m] = EMPTY;
  st.h1 ^= z1[m * 3 + color];
  st.h2 ^= z2[m * 3 + color];
  if (g.bitboard) cubeToggleBit(st, color, m);
  else {
    if (st.trackNb) {
      const nbc = st.nbc, off = color * st.n;
      for (let j = g.nbStart[m], e = g.nbStart[m + 1]; j < e; j++) nbc[off + g.nbCells[j]]--;
    }
    st.ecount++;
  }
  st.count[color] -= flipped + 1;
  st.count[other] += flipped;
}

function cubeIsLegal(st, i, color) {
  const g = st.g, cells = st.cells, other = 3 - color;
  if (cells[i] !== EMPTY) return false;
  const base = i * 26;
  for (let d = 0; d < 26; d++) {
    const len = g.rayLen[base + d];
    if (len < 2) continue;
    const s = g.rayStart[base + d];
    if (cells[g.rayCells[s]] !== other) continue;
    for (let k = 1; k < len; k++) {
      const v = cells[g.rayCells[s + k]];
      if (v === other) continue;
      if (v === color) return true;
      break;
    }
  }
  return false;
}

function cubeMoveMask(st, color) {
  const k = (color - 1) * 2, o = (2 - color) * 2;
  bbMoves(st.g, st.bb[k], st.bb[k + 1], st.bb[o], st.bb[o + 1]);
}

function cubeGenMoves(st, color, out) {
  let count = 0;
  if (st.g.bitboard) {
    cubeMoveMask(st, color);
    let lo = bbOutLo, hi = bbOutHi;
    while (lo) {
      const b = lo & -lo;
      out[count++] = 31 - Math.clz32(b);
      lo ^= b;
    }
    while (hi) {
      const b = hi & -hi;
      out[count++] = 63 - Math.clz32(b);
      hi ^= b;
    }
    return count;
  }
  // Moves are emitted in board-index order (spatially grouped); the search's
  // stable move ordering relies on it (the empty list itself is unordered).
  const nbc = st.nbc, off = (3 - color) * st.n, cells = st.cells, n = st.n;
  if (st.trackNb) {
    for (let i = 0; i < n; i++) {
      if (cells[i] === EMPTY && nbc[off + i] && cubeIsLegal(st, i, color)) out[count++] = i;
    }
    return count;
  }
  const elist = st.elist;
  for (let k = 0, e = st.ecount; k < e; k++) {
    const i = elist[k];
    if (!cubeIsLegal(st, i, color)) continue;
    let j = count++;
    while (j > 0 && out[j - 1] > i) { out[j] = out[j - 1]; j--; }
    out[j] = i;
  }
  return count;
}

function cubeMobility(st, color) {
  if (st.g.bitboard) {
    cubeMoveMask(st, color);
    return popcount32(bbOutLo) + popcount32(bbOutHi);
  }
  const nbc = st.nbc, off = (3 - color) * st.n, elist = st.elist;
  let count = 0;
  if (!st.trackNb) {
    for (let k = 0, e = st.ecount; k < e; k++) if (cubeIsLegal(st, elist[k], color)) count++;
    return count;
  }
  for (let k = 0, e = st.ecount; k < e; k++) {
    const i = elist[k];
    if (nbc[off + i] && cubeIsLegal(st, i, color)) count++;
  }
  return count;
}

function cubeMoveList(st, ply) {
  let list = st.moveLists[ply];
  if (!list) {
    list = new Int16Array(st.n);
    st.moveLists[ply] = list;
    st.orderScores[ply] = new Float64Array(st.n);
  }
  return list;
}

// Stable-disc lower bound generalised to 13 line axes: a disc is stable when,
// on every axis, its line is full or one neighbour along the axis is the board
// boundary or a stable disc of the same colour. Corners are always stable.
function cubeStableCounts(st) {
  const g = st.g, cells = st.cells, n = st.n, stable = st.scratch;
  stable.fill(0);
  let anyCorner = false;
  for (let k = 0; k < g.corners.length; k++) {
    const c = g.corners[k];
    if (cells[c] !== EMPTY) { stable[c] = 1; anyCorner = true; }
  }
  const result = [0, 0, 0];
  if (!anyCorner) return result;
  let changed = true;
  let passes = 0;
  while (changed && passes < 6) {
    changed = false;
    passes++;
    for (let i = 0; i < n; i++) {
      const v = cells[i];
      if (v === EMPTY || stable[i]) continue;
      let ok = true;
      for (let a = 0; a < 13 && ok; a++) {
        const d = CUBE_AXES[a];
        const od = CUBE_OPPOSITE[d];
        const lenA = g.rayLen[i * 26 + d];
        const lenB = g.rayLen[i * 26 + od];
        if (lenA === 0 || lenB === 0) continue;
        const na = g.rayCells[g.rayStart[i * 26 + d]];
        const nb = g.rayCells[g.rayStart[i * 26 + od]];
        if ((stable[na] && cells[na] === v) || (stable[nb] && cells[nb] === v)) continue;
        let full = true;
        const sa = g.rayStart[i * 26 + d];
        for (let k = 0; k < lenA && full; k++) if (cells[g.rayCells[sa + k]] === EMPTY) full = false;
        const sb = g.rayStart[i * 26 + od];
        for (let k = 0; k < lenB && full; k++) if (cells[g.rayCells[sb + k]] === EMPTY) full = false;
        if (!full) ok = false;
      }
      if (ok) { stable[i] = 1; changed = true; }
    }
  }
  for (let i = 0; i < n; i++) {
    if (stable[i] && !g.isCornerCell[i]) result[cells[i]]++;
  }
  return result;
}

// Region parity over 26-connected empty regions: an odd region in which the
// side to move can play is good for it; an odd region only the opponent can
// enter is good for the opponent.
function cubeRegionParity(st, p) {
  const g = st.g, cells = st.cells, n = st.n, seen = st.scratch, queue = st.queue;
  seen.fill(0);
  const o = 3 - p;
  let score = 0;
  for (let i = 0; i < n; i++) {
    if (cells[i] !== EMPTY || seen[i]) continue;
    let head = 0, tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    let size = 0, pCan = false, oCan = false;
    while (head < tail) {
      const c = queue[head++];
      size++;
      if (!pCan && cubeIsLegal(st, c, p)) pCan = true;
      if (!oCan && cubeIsLegal(st, c, o)) oCan = true;
      for (let j = g.nbStart[c], e = g.nbStart[c + 1]; j < e; j++) {
        const nb = g.nbCells[j];
        if (cells[nb] === EMPTY && !seen[nb]) { seen[nb] = 1; queue[tail++] = nb; }
      }
    }
    if (size % 2 === 1) {
      if (pCan) score += 1;
      else if (oCan) score -= 1;
    } else if (pCan && !oCan) {
      score += 0.5;
    } else if (oCan && !pCan) {
      score -= 0.5;
    }
  }
  return score;
}

function cubeRatio(a, b) {
  return (100 * (a - b)) / (a + b + 2);
}

// Static evaluation from the side to move's perspective.
function cubeEvaluate(st, p, ownMobility, wantBreakdown = false) {
  const g = st.g, cells = st.cells, o = 3 - p, W = CUBE_WEIGHTS_BY_SIZE[g.size] || CUBE_WEIGHTS;
  const n = st.n;
  const empties = n - st.count[1] - st.count[2];
  const progress = 1 - empties / (n - 8);

  // Corners, line-based corner access and line-based latent corner danger.
  let ownC = 0, oppC = 0, ownCA = 0, oppCA = 0, ownRisk = 0, oppRisk = 0;
  for (let k = 0; k < g.corners.length; k++) {
    const c = g.corners[k];
    const v = cells[c];
    if (v === p) { ownC++; continue; }
    if (v === o) { oppC++; continue; }
    const dirs = g.cornerDirs[k];
    let pAccess = false, oAccess = false;
    for (let t = 0; t < dirs.length; t++) {
      const d = dirs[t];
      const s = g.rayStart[c * 26 + d], len = g.rayLen[c * 26 + d];
      const first = cells[g.rayCells[s]];
      if (first === EMPTY) continue;
      let j = 1;
      while (j < len && cells[g.rayCells[s + j]] === first) j++;
      if (j === len) continue;
      const next = cells[g.rayCells[s + j]];
      if (next === EMPTY) {
        if (first === p) ownRisk++; else oppRisk++;
      } else if (first === p) {
        oAccess = true; // opponent can capture the corner along this line now
      } else {
        pAccess = true;
      }
    }
    if (pAccess) ownCA++;
    if (oAccess) oppCA++;
  }

  const otherMobility = cubeMobility(st, o);
  const mob = ownMobility;

  // Frontier and potential mobility (26 neighbours).
  let ownFront = 0, oppFront = 0, ownPot = 0, oppPot = 0;
  if (g.bitboard) {
    const k = (p - 1) * 2, q = (o - 1) * 2;
    const pLo = st.bb[k], pHi = st.bb[k + 1], oLo = st.bb[q], oHi = st.bb[q + 1];
    const eLo = ~(pLo | oLo), eHi = ~(pHi | oHi);
    bbDilate(g, eLo, eHi);
    const nEL = bbOutLo, nEH = bbOutHi;
    ownFront = popcount32(pLo & nEL) + popcount32(pHi & nEH);
    oppFront = popcount32(oLo & nEL) + popcount32(oHi & nEH);
    bbDilate(g, oLo, oHi);
    ownPot = popcount32(eLo & bbOutLo) + popcount32(eHi & bbOutHi);
    bbDilate(g, pLo, pHi);
    oppPot = popcount32(eLo & bbOutLo) + popcount32(eHi & bbOutHi);
  } else {
    const nbc = st.nbc, offP = p * n, offO = o * n, deg = g.deg;
    for (let i = 0; i < n; i++) {
      const v = cells[i];
      if (v === EMPTY) {
        if (nbc[offO + i]) ownPot++;
        if (nbc[offP + i]) oppPot++;
        continue;
      }
      if (deg[i] > nbc[n + i] + nbc[2 * n + i]) {
        if (v === p) ownFront++; else oppFront++;
      }
    }
  }

  const stableCounts = (ownC + oppC) > 0 ? cubeStableCounts(st) : [0, 0, 0];

  const late = empties <= Math.min(24, Math.floor((n - 8) * 0.4));
  let parity = 0;
  let regionParity = 0;
  if (late) {
    parity = empties % 2 === 1 ? 1 : -1;
    if (empties <= 22) regionParity = cubeRegionParity(st, p);
  }

  const mobilityWeightScale = late ? 0.6 : 1;
  const discWeight = progress < 0.45 ? W.discEarly : (late ? W.discLate : W.discMid);
  const components = {
    corners: W.corner * (ownC - oppC),
    cornerAccess: W.ownCornerAccess * ownCA - W.oppCornerAccess * oppCA,
    cornerLines: W.lineRisk * (oppRisk - ownRisk),
    mobility: mobilityWeightScale * (W.mobilityDiff * (mob - otherMobility) + W.mobilityRatio * cubeRatio(mob, otherMobility)),
    potential: W.potential * cubeRatio(ownPot, oppPot),
    frontier: W.frontier * cubeRatio(oppFront, ownFront),
    edge: 0,
    edgeStructure: 0,
    discs: discWeight * (st.count[p] - st.count[o]),
    parity: W.parity * parity,
    regionParity: W.regionParity * regionParity,
    pass: otherMobility === 0 ? W.pass : 0,
    position: 0,
    stability: W.stable * (stableCounts[p] - stableCounts[o]),
    tempo: -W.tempo
  };
  let total = 0;
  for (const key in components) total += components[key];
  total = Math.round(total);
  if (!wantBreakdown) return total;
  components.total = total;
  return components;
}

function cubeTerminal(st, color) {
  const diff = st.count[color] - st.count[3 - color];
  if (diff > 0) return CUBE_WIN + diff * 1000;
  if (diff < 0) return -CUBE_WIN + diff * 1000;
  return 0;
}

// ---- Transposition tables -------------------------------------------------
const CUBE_TT_BITS = 19;
const CUBE_TT_SIZE = 1 << CUBE_TT_BITS;
const CUBE_TT_MASK = CUBE_TT_SIZE - 1;
let cubeTT = null;
let cubeSolveTT = null;
function createCubeTable(size) {
  return {
    k1: new Int32Array(size),
    k2: new Int32Array(size),
    score: new Int32Array(size),
    depth: new Int8Array(size),
    flag: new Int8Array(size), // 0 empty, 1 exact, 2 lower, 3 upper
    move: new Int16Array(size),
    age: new Uint8Array(size),
    mask: size - 1,
    currentAge: 1,
    size: 0
  };
}
function ensureCubeTables() {
  if (!cubeTT) cubeTT = createCubeTable(CUBE_TT_SIZE);
  if (!cubeSolveTT) cubeSolveTT = createCubeTable(1 << 18);
}
// Board-size-specific tables are reset when the board size changes.
let cubeTableBoardSize = 0;
// 2.0.7: one pair of tables per difficulty level (see chooseMove3D).
const cubeTableSets = new Map();
function selectCubeTables(size, difficulty) {
  if (cubeTableBoardSize !== size) {
    cubeTableSets.clear();
    cubeTableBoardSize = size;
  }
  let set = cubeTableSets.get(difficulty);
  if (!set) {
    set = { tt: createCubeTable(CUBE_TT_SIZE), solveTT: createCubeTable(1 << 18) };
    cubeTableSets.set(difficulty, set);
  }
  cubeTT = set.tt;
  cubeSolveTT = set.solveTT;
}

function ttKey1(st, color) { return color === WHITE ? st.h1 ^ st.g.side1 : st.h1; }
function ttKey2(st, color) { return color === WHITE ? st.h2 ^ st.g.side2 : st.h2; }

function ttStore(tt, k1, k2, depth, flag, score, move) {
  const slot = k1 & tt.mask;
  if (tt.flag[slot] !== 0 && tt.age[slot] === tt.currentAge && tt.depth[slot] > depth &&
      !(tt.k1[slot] === k1 && tt.k2[slot] === k2)) {
    return false;
  }
  if (tt.flag[slot] === 0) tt.size++;
  tt.k1[slot] = k1;
  tt.k2[slot] = k2;
  tt.depth[slot] = depth;
  tt.flag[slot] = flag;
  tt.score[slot] = score;
  tt.move[slot] = move;
  tt.age[slot] = tt.currentAge;
  return true;
}

// ---- Exact endgame solver (disc difference) --------------------------------
function cubeSolve(st, color, alpha, beta, passed, ply) {
  if ((++st.solveNodes & 1023) === 0 && performance.now() > st.deadline) st.timedOut = true;
  if (st.timedOut) return 0;
  st.nodes++;
  const other = 3 - color;
  const empties = st.n - st.count[1] - st.count[2];
  if (empties === 0) return st.count[color] - st.count[other];

  const tt = cubeSolveTT;
  const k1 = ttKey1(st, color), k2 = ttKey2(st, color);
  const slot = k1 & tt.mask;
  let ttMove = -1;
  if (empties > 4 && tt.flag[slot] && tt.k1[slot] === k1 && tt.k2[slot] === k2) {
    ttMove = tt.move[slot];
    const s = tt.score[slot], f = tt.flag[slot];
    if (f === 1) return s;
    if (f === 2 && s >= beta) return s;
    if (f === 3 && s <= alpha) return s;
    if (f === 2 && s > alpha) alpha = s;
    if (f === 3 && s < beta) beta = s;
  }

  const moves = cubeMoveList(st, ply);
  const count = cubeGenMoves(st, color, moves);
  if (count === 0) {
    if (passed) return st.count[color] - st.count[other];
    if (cubeMobility(st, other) === 0) return st.count[color] - st.count[other];
    return -cubeSolve(st, other, -beta, -alpha, true, ply + 1);
  }

  // Ordering: TT move, corners, then fewest opponent replies (fastest first).
  if (count > 1) {
    const scores = st.orderScores[ply];
    const g = st.g;
    const isoW = g.bitboard ? 0 : CUBE_WEIGHTS.solveIsolation;
    for (let i = 0; i < count; i++) {
      const m = moves[i];
      let s = 0;
      if (m === ttMove) s = -1000;
      else {
        if (g.isCornerCell[m]) s -= 50;
        if (isoW) {
          // Larger cubes: prefer cells with few empty neighbours (finish small
          // pockets first, a cheap stand-in for region parity).
          let ne = 0;
          for (let j = g.nbStart[m], e = g.nbStart[m + 1]; j < e; j++) if (st.cells[g.nbCells[j]] === EMPTY) ne++;
          s += ne * isoW;
        }
        if (empties > 6) {
          const f = cubeMakeMove(st, m, color);
          s += cubeMobility(st, other) * 4;
          cubeUndoMove(st, m, color, f);
        }
      }
      scores[i] = s;
    }
    for (let i = 1; i < count; i++) {
      const m = moves[i], s = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] > s) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = m; scores[j + 1] = s;
    }
  }

  const originalAlpha = alpha;
  let best = -CUBE_INF, bestMove = -1;
  for (let i = 0; i < count; i++) {
    const m = moves[i];
    const f = cubeMakeMove(st, m, color);
    let score;
    if (i === 0) {
      score = -cubeSolve(st, other, -beta, -alpha, false, ply + 1);
    } else {
      score = -cubeSolve(st, other, -alpha - 1, -alpha, false, ply + 1);
      if (score > alpha && score < beta && !st.timedOut) {
        score = -cubeSolve(st, other, -beta, -score, false, ply + 1);
      }
    }
    cubeUndoMove(st, m, color, f);
    if (st.timedOut) return 0;
    if (score > best) { best = score; bestMove = m; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (empties > 4) {
    const flag = best <= originalAlpha ? 3 : (best >= beta ? 2 : 1);
    ttStore(tt, k1, k2, empties, flag, best, bestMove);
  }
  return best;
}

function cubeDiffToScore(diff) {
  if (diff > 0) return CUBE_WIN + diff * 1000;
  if (diff < 0) return -CUBE_WIN + diff * 1000;
  return 0;
}

// ---- Midgame search -----------------------------------------------------
function cubeSearch(st, color, depth, alpha, beta, passed, ply) {
  if ((++st.nodes & 1023) === 0 && performance.now() > st.deadline) st.timedOut = true;
  if (st.timedOut) return 0;
  const other = 3 - color;
  const empties = st.n - st.count[1] - st.count[2];
  if (empties === 0) return cubeTerminal(st, color);

  // Small endgames are handed to the exact solver: cheaper and exact.
  if (empties <= st.inSearchSolve && depth >= 2) {
    const track = st.trackNb;
    st.trackNb = false;
    const diff = cubeSolve(st, color, -st.n - 1, st.n + 1, passed, ply);
    st.trackNb = track;
    if (st.timedOut) return 0;
    return cubeDiffToScore(diff);
  }

  const tt = cubeTT;
  const k1 = ttKey1(st, color), k2 = ttKey2(st, color);
  const slot = k1 & tt.mask;
  let ttMove = -1;
  if (tt.flag[slot] && tt.k1[slot] === k1 && tt.k2[slot] === k2) {
    ttMove = tt.move[slot];
    if (tt.depth[slot] >= depth) {
      const s = tt.score[slot], f = tt.flag[slot];
      if (f === 1) return s;
      if (f === 2 && s >= beta) return s;
      if (f === 3 && s <= alpha) return s;
    }
  }

  const moves = cubeMoveList(st, ply);
  const count = cubeGenMoves(st, color, moves);
  if (count === 0) {
    if (passed || cubeMobility(st, other) === 0) return cubeTerminal(st, color);
    return -cubeSearch(st, other, depth, -beta, -alpha, true, ply + 1);
  }
  if (depth <= 0) {
    st.leaves++;
    return cubeEvaluate(st, color, count);
  }

  // Move ordering.
  const g = st.g;
  const scores = st.orderScores[ply];
  const killerA = st.killers[ply * 2], killerB = st.killers[ply * 2 + 1];
  const hist = st.history;
  const deep = depth >= 3;
  for (let i = 0; i < count; i++) {
    const m = moves[i];
    let s = hist[color * st.n + m];
    if (m === ttMove) s += 1e9;
    if (g.isCornerCell[m]) s += 1e7;
    if (m === killerA) s += 5e6;
    else if (m === killerB) s += 4e6;
    if (deep && m !== ttMove) {
      const f = cubeMakeMove(st, m, color);
      s -= cubeMobility(st, other) * 2000;
      // Line-based: does this move hand the opponent a corner capture?
      for (let k = 0; k < g.corners.length; k++) {
        const c = g.corners[k];
        if (st.cells[c] === EMPTY && cubeIsLegal(st, c, other)) s -= 60000;
      }
      cubeUndoMove(st, m, color, f);
    }
    scores[i] = s;
  }
  for (let i = 1; i < count; i++) {
    const m = moves[i], s = scores[i];
    let j = i - 1;
    while (j >= 0 && scores[j] < s) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
    moves[j + 1] = m; scores[j + 1] = s;
  }

  const originalAlpha = alpha;
  let best = -CUBE_INF, bestMove = -1;
  for (let i = 0; i < count; i++) {
    const m = moves[i];
    const f = cubeMakeMove(st, m, color);
    let score;
    if (i === 0) {
      score = -cubeSearch(st, other, depth - 1, -beta, -alpha, false, ply + 1);
    } else {
      score = -cubeSearch(st, other, depth - 1, -alpha - 1, -alpha, false, ply + 1);
      if (score > alpha && score < beta && !st.timedOut) {
        score = -cubeSearch(st, other, depth - 1, -beta, -score, false, ply + 1);
      }
    }
    cubeUndoMove(st, m, color, f);
    if (st.timedOut) return 0;
    if (score > best) { best = score; bestMove = m; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      st.cutoffs++;
      if (m !== killerA) { st.killers[ply * 2 + 1] = killerA; st.killers[ply * 2] = m; }
      hist[color * st.n + m] += depth * depth;
      break;
    }
  }
  const flag = best <= originalAlpha ? 3 : (best >= beta ? 2 : 1);
  if (ttStore(tt, k1, k2, depth, flag, best, bestMove)) st.ttStores++;
  return best;
}

// Root search with a "variety margin": every move whose score is within
// `margin` of the best is searched exactly so near-equal moves can be
// identified; everything else is refuted with a null window (PVS).
function cubeSearchRoot(st, color, rootMoves, depth, margin) {
  const other = 3 - color;
  const results = [];
  let best = -CUBE_INF;
  for (let i = 0; i < rootMoves.length; i++) {
    const m = rootMoves[i];
    const f = cubeMakeMove(st, m, color);
    let score;
    if (i === 0) {
      score = -cubeSearch(st, other, depth - 1, -CUBE_INF, CUBE_INF, false, 1);
    } else {
      const t = best - margin;
      score = -cubeSearch(st, other, depth - 1, -t, -t + 1, false, 1);
      if (score >= t && !st.timedOut) {
        score = -cubeSearch(st, other, depth - 1, -CUBE_INF, -t + 1, false, 1);
      }
    }
    cubeUndoMove(st, m, color, f);
    if (st.timedOut) return null;
    results.push({ move: m, score, exact: i === 0 || score >= best - margin });
    if (score > best) best = score;
  }
  return { best, results };
}

function cubeSolveRoot(st, color, rootMoves) {
  const other = 3 - color;
  const results = [];
  let best = -CUBE_INF;
  for (let i = 0; i < rootMoves.length; i++) {
    const m = rootMoves[i];
    const f = cubeMakeMove(st, m, color);
    let score;
    if (i === 0) {
      score = -cubeSolve(st, other, -st.n - 1, st.n + 1, false, 1);
    } else {
      score = -cubeSolve(st, other, -best - 1, -best, false, 1);
      if (score > best && !st.timedOut) score = -cubeSolve(st, other, -st.n - 1, -score, false, 1);
    }
    cubeUndoMove(st, m, color, f);
    if (st.timedOut) return null;
    results.push({ move: m, score, exact: i === 0 || score > best });
    if (score > best) best = score;
  }
  return { best, results };
}

// Phase-based time allocation: spend less in the opening, more in the
// 13–20-empty window where exact solving becomes reachable.
function cubeTimeBudget(baseMs, empties, n, difficulty, solveLimit) {
  if (difficulty === 'easy') return baseMs;
  const frac = empties / (n - 8);
  let mult;
  if (empties <= solveLimit && empties > 10) mult = 2.2;
  else if (empties <= 10) mult = 1;
  else if (frac > 0.65) mult = 0.65;
  else if (frac > 0.4) mult = 0.9;
  else mult = 1.3;
  const cap = Math.min(Math.max(baseMs, 10000), baseMs * 3);
  return Math.min(cap, baseMs * mult);
}

// 2.0.5: exact-solve thresholds. Medium is handicapped (fixed, low); Hard's
// threshold now depends on its thinking time, because at about 1 s a solve
// from 17-20 empties on 4x4x4 almost never finishes (measured 0-7%) and the
// failed attempt costs most of the move's budget. Easy is unchanged.
function cubeSolveLimit(size, difficulty, baseMs = 1100) {
  if (difficulty === 'easy') return 8;
  if (difficulty === 'medium') return size === 4 ? MEDIUM_SOLVE_LIMIT_4 : 11;
  if (size === 4) {
    if (baseMs < 700) return 14;
    if (baseMs < 1500) return 16;
    if (baseMs < 3000) return 18;
    return 20;
  }
  // Larger cubes: 14 is what the solver finishes at the 1.1 s default
  // (measured in 1.34.1); allow a little more with a longer budget.
  if (baseMs < 700) return 13;
  if (baseMs < 3000) return 14;
  if (baseMs < 6000) return 15;
  return 16;
}

// 2.0.5: difficulty search caps for the 3D engine. Before 2.0.5 Medium and
// Hard ran the identical search and evaluation, so at equal thinking time
// they were the same strength (only opening variety and the solve threshold
// differed). Medium's midgame search is now capped at a shallow depth and
// Easy is shallower still, so Hard is stronger at any equal time.
const MEDIUM_MAX_DEPTH = 5;
const EASY_MAX_DEPTH = 2;
const MEDIUM_SOLVE_LIMIT_4 = 12;

function cubeIndexToMove(st, i) {
  return [st.g.coord[i * 3], st.g.coord[i * 3 + 1], st.g.coord[i * 3 + 2]];
}

function chooseMove3D(moveOptions, context, profile) {
  const startedAt = performance.now();
  const size = context.boardSize;
  const board = context.board;
  const player = context.player;
  const difficulty = DIFFICULTY_PROFILES[context.difficulty] ? context.difficulty : 'medium';
  // 2.0.7: each difficulty level has its own transposition tables. Before,
  // one Worker served both Bots in Bot vs Bot and they shared one table, so
  // Medium's depth-5 search was answered from Hard's deeper entries (and its
  // solver from Hard's solved positions) and played almost as well as Hard.
  selectCubeTables(size, difficulty);
  cubeTT.currentAge = (cubeTT.currentAge % 250) + 1;
  cubeSolveTT.currentAge = (cubeSolveTT.currentAge % 250) + 1;


  const st = createCubeState(board, size);
  const n = st.n;
  const empties = n - st.count[1] - st.count[2];
  const plyFromStart = n - 8 - empties;

  // Authoritative legal moves come from the controller; map them to indices.
  const rootMoves = [];
  for (const option of moveOptions) {
    const [x, y, z] = option.move;
    const i = (x * size + y) * size + z;
    if (cubeIsLegal(st, i, player)) rootMoves.push(i);
  }
  if (!rootMoves.length) return null; // caller falls back to the legacy engine

  const defaultTimeLimit = profile.threeDTimeMs;
  const customTimeLimit = Number(context.thinkingTimeMs);
  const baseMs = Number.isFinite(customTimeLimit) && customTimeLimit >= 0
    ? Math.min(10000, customTimeLimit)
    : defaultTimeLimit;
  const solveLimit = cubeSolveLimit(size, difficulty, baseMs);
  const budgetMs = cubeTimeBudget(baseMs, empties, n, difficulty, solveLimit);
  const deadline = startedAt + budgetMs;
  st.deadline = deadline;
  st.inSearchSolve = size === 4 ? 7 : 6;

  // Static breakdown after each root move (Bot Summary diagnostics).
  const breakdowns = new Map();
  for (const m of rootMoves) {
    const f = cubeMakeMove(st, m, player);
    const other = 3 - player;
    const otherMob = cubeMobility(st, other);
    const b = cubeEvaluate(st, other, otherMob, true);
    const mine = {};
    for (const key in b) mine[key] = -b[key];
    breakdowns.set(m, mine);
    cubeUndoMove(st, m, player, f);
  }

  const stats = {
    nodes: 0, leaves: 0, cutoffs: 0, tableEntries: 0,
    completedDepth: 0,
    targetDepth: empties,
    source: 'SEARCH',
    bookName: null,
    bookPly: 0,
    rootCandidateScores: [],
    rootCandidateScoreHistory: [],
    engine: `3D ${CUBE_ENGINE_VERSION}`,
    timeBudgetMs: Math.round(budgetMs),
    empties,
    exactSolve: false,
    solvedDiscDiff: null,
    nps: 0
  };
  const toCandidates = (results) => results.map((r) => ({
    move: cubeIndexToMove(st, r.move),
    score: r.score,
    breakdown: breakdowns.get(r.move) ? { ...breakdowns.get(r.move) } : null
  }));

  let bestMove = rootMoves[0];
  let lastResults = null;

  if (rootMoves.length === 1) {
    stats.source = 'FORCED';
    stats.targetDepth = 0;
    chooseMove.lastSearchStats = stats;
    return cubeIndexToMove(st, bestMove);
  }

  // Opening variety: Medium/Easy choose among near-equal moves in the first
  // plies; Hard only breaks exact ties (e.g. symmetric corners).
  const varietyPlies = 12;
  const inOpening = plyFromStart < varietyPlies;
  let margin = 0;
  if (inOpening) margin = difficulty === 'hard' ? 0 : (difficulty === 'medium' ? 25 : 60);
  const maxDepth = difficulty === 'easy'
    ? EASY_MAX_DEPTH
    : (difficulty === 'medium' ? Math.min(MEDIUM_MAX_DEPTH, empties + 2) : empties + 2);

  const trySolve = empties <= solveLimit;
  const midgameDeadline = trySolve && empties > 10 ? startedAt + budgetMs * 0.3 : deadline;
  const softStop = trySolve ? midgameDeadline : startedAt + budgetMs * 0.5;

  // 2.0.7: Hard always completes at least one ply more than Medium's depth
  // cap, even when that takes longer than its time budget (on a slow
  // Chromebook the budget alone left Hard barely deeper than Medium, whose
  // fixed depth 5 is cheap enough to finish on any machine). The floor
  // has an emergency limit so a very slow machine never stalls.
  const hardMinDepth = difficulty === 'hard' ? Math.min(MEDIUM_MAX_DEPTH + 1, maxDepth) : 0;
  const floorDeadline = Math.max(midgameDeadline, startedAt + Math.min(HARD_FLOOR_MAX_MS, budgetMs * HARD_FLOOR_BUDGET_FACTOR));
  // Bot Summary: the deepest the search may go this move (Medium's cap, or
  // the empties-based ceiling) and the guaranteed minimum (Hard only).
  stats.targetDepth = trySolve && empties <= 10 ? empties : maxDepth;
  stats.minDepth = hardMinDepth;

  // Iterative deepening midgame search.
  if (!(trySolve && empties <= 10)) {
    st.deadline = midgameDeadline;
    let order = rootMoves.slice();
    for (let depth = 1; depth <= maxDepth; depth++) {
      st.deadline = depth <= hardMinDepth ? floorDeadline : midgameDeadline;
      if (depth > hardMinDepth && performance.now() >= midgameDeadline) break;
      const result = cubeSearchRoot(st, player, order, depth, margin);
      if (!result) break;
      lastResults = result.results;
      stats.completedDepth = depth;
      stats.rootCandidateScoreHistory.push({ depth, candidates: toCandidates(result.results) });
      const sorted = result.results.slice().sort((a, b) => b.score - a.score);
      bestMove = sorted[0].move;
      order = sorted.map((r) => r.move);
      if (Math.abs(sorted[0].score) >= CUBE_WIN && depth >= empties) break;
      if (depth >= hardMinDepth && performance.now() >= softStop) break;
    }
  }

  // Exact endgame solve.
  if (trySolve) {
    st.timedOut = false;
    st.deadline = deadline;
    const order = lastResults
      ? lastResults.slice().sort((a, b) => b.score - a.score).map((r) => r.move)
      : rootMoves.slice();
    st.trackNb = false;
    const solved = cubeSolveRoot(st, player, order);
    st.trackNb = true;
    if (solved) {
      const results = solved.results.map((r) => ({ ...r, score: cubeDiffToScore(r.score) }));
      const sorted = solved.results.slice().sort((a, b) => b.score - a.score);
      bestMove = sorted[0].move;
      lastResults = results;
      stats.source = 'SOLVE';
      stats.exactSolve = true;
      stats.solvedDiscDiff = sorted[0].score;
      stats.completedDepth = empties;
      stats.rootCandidateScoreHistory.push({ depth: empties, candidates: toCandidates(results) });
      margin = 0;
    }
  }

  // Choose among near-equal candidates.
  if (lastResults && lastResults.length > 1) {
    const best = Math.max(...lastResults.map((r) => r.score));
    if (difficulty === 'easy' && profile.randomness > 0 && stats.source !== 'SOLVE') {
      const ranked = lastResults.slice().sort((a, b) => b.score - a.score);
      const pool = ranked.slice(0, Math.min(4, ranked.length));
      bestMove = pool[Math.floor(Math.pow(Math.random(), 1.7) * pool.length)].move;
    } else if (inOpening && stats.source !== 'SOLVE') {
      const pool = lastResults.filter((r) => r.exact && r.score >= best - margin);
      if (pool.length > 1) bestMove = pool[Math.floor(Math.random() * pool.length)].move;
    }
  }

  const elapsed = Math.max(1, performance.now() - startedAt);
  stats.nodes = st.nodes;
  stats.leaves = st.leaves;
  stats.cutoffs = st.cutoffs;
  stats.tableEntries = cubeTT.size + cubeSolveTT.size;
  stats.nps = Math.round((st.nodes * 1000) / elapsed);
  stats.rootCandidateScores = stats.rootCandidateScoreHistory.length
    ? stats.rootCandidateScoreHistory[stats.rootCandidateScoreHistory.length - 1].candidates
    : [];
  chooseMove.lastSearchStats = stats;
  return cubeIndexToMove(st, bestMove);
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
    const bookResult = chooseClassicBookMove(board, player, moveOptions, context.difficulty === 'medium');
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

  // 1.35.0: cube opening book. Book positions are played instantly on every
  // difficulty; Hard always takes the best-scored book move, Medium and Easy
  // choose among near-best book moves for variety.
  if (depth > 1 && depth === size && CUBE_OPENING_BOOK[size] && context.useOpeningBook !== false) {
    const bookResult = chooseCubeBookMove(board, size, player, moveOptions, context.difficulty || 'medium');
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
        bookScore: bookResult.score,
        bookCandidates: bookResult.candidates
      };
      return bookResult.move;
    }
  }

  // 1.34.0: cubic 3D boards use the dedicated 3D engine. Classic is unchanged.
  if (depth > 1 && depth === size && size >= 4) {
    const cubeMove = chooseMove3D(moveOptions, context, profile);
    if (cubeMove && moveOptions.some((option) => moveKey(option.move) === moveKey(cubeMove))) {
      return cubeMove;
    }
  }

  const defaultTimeLimit = depth === 1 ? profile.classicTimeMs : profile.threeDTimeMs;
  const customTimeLimit = Number(context.thinkingTimeMs);
  const timeLimit = Number.isFinite(customTimeLimit) && customTimeLimit >= 0
    ? Math.min(10000, customTimeLimit)
    : defaultTimeLimit;
  const deadline = performance.now() + timeLimit;

  // Search depth is no longer capped by a fixed difficulty-specific maximum.
  // The remaining empty cells provide a practical game-state ceiling, while the
  // time deadline remains the actual limit on how much search can be completed.
  // This lets 3D Hard use all available thinking time when deeper iterations are
  // still possible, without allowing an unbounded recursion depth.
  const targetDepth = Math.max(1, counts.empty + 2);

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
