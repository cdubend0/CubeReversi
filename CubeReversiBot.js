/*
 * Cube Reversi 1.23.0 — Bot Engine
 *
 * The Bot Engine evaluates authoritative move data supplied by CubeReversi.js.
 * CubeReversi.js remains responsible for game state, rules, legal-move
 * generation, rendering, turn management, and actually committing moves.
 * The exported chooseMove() function is the game controller's decision interface.
 * It accepts move options containing authoritative flip counts, mobility counts,
 * surface-access data, and optional position context.
 */

export function chooseMove(moveOptions, context = null) {
  if (!Array.isArray(moveOptions) || moveOptions.length === 0) return null;

  void context;

  // Preserve the established mobility priorities.
  const bestOpponentMoves = Math.min(...moveOptions.map((option) => option.opponentMoves));
  const opponentMobilityLeaders = moveOptions.filter(
    (option) => option.opponentMoves === bestOpponentMoves
  );

  const bestOwnMoves = Math.max(...opponentMobilityLeaders.map((option) => option.ownMoves));
  const ownMobilityLeaders = opponentMobilityLeaders.filter(
    (option) => option.ownMoves === bestOwnMoves
  );

  // 1.19.3 continuation: corner position is now the first strategic priority.
  // A true corner must be selected when available; a move adjacent to a
  // secured corner is next-best, while moves adjacent to an unsecured or
  // opponent-owned corner are discouraged. This applies to every board size.
  const bestCornerPosition = Math.max(
    ...moveOptions.map((option) => option.cornerPosition)
  );
  const cornerLeaders = moveOptions.filter(
    (option) => option.cornerPosition === bestCornerPosition
  );

  // After corner priority, use the established mobility criteria.
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

  // Keep immediate piece gain as the final tiebreaker.
  const bestFlips = Math.max(...finalLeaders.map((option) => option.flips));
  const bestOptions = finalLeaders.filter(
    (option) => option.flips === bestFlips
  );

  return bestOptions[Math.floor(Math.random() * bestOptions.length)].move;
}
