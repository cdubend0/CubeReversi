# Third-Party Notices

Cube Reversi is an independently written browser-based Reversi implementation. The
projects and resources listed below were consulted as research and design references
during development of the Cube Reversi game and computer opponent.

Unless specifically stated otherwise, Cube Reversi does **not** incorporate source
code from these projects. Their inclusion here acknowledges the projects and authors
whose publicly available implementations, documentation, and strategy material helped
inform the development and research process.

## Othello Sensei

**Project:** Othello Sensei  
**Author:** Michele Borassi  
**Repository:** https://github.com/borassi/othello-sensei  
**License:** Apache License 2.0

Othello Sensei was consulted for established approaches to Othello search and
evaluation, including pattern-based evaluation, corner and edge patterns, opening
books, and endgame analysis.

No Othello Sensei source code has been intentionally copied into Cube Reversi.

The Othello Sensei repository is licensed under the Apache License 2.0. If material
from that repository is ever incorporated into Cube Reversi in the future, the
applicable Apache License notice and requirements must be followed.

## Deft Reversi

**Project:** Deft Reversi  
**Author/Repository:** ikepggthb  
**Repository:** https://github.com/ikepggthb/deft-reversi  
**License:** GNU General Public License v3.0

Deft Reversi was consulted for strong-engine search and evaluation techniques,
including bitboards, Negascout/PVS, transposition tables, Multi Prob Cut, move
ordering, iterative deepening, and pattern-based evaluation.

No Deft Reversi source code has been intentionally copied into Cube Reversi.

### Historical Deft Reversi Engine repository

An earlier archived repository, `deft-reversi-engine`, was also encountered during
the research process:

https://github.com/ikepggthb/deft-reversi-engine

That archived repository identifies itself as MIT licensed and states that development
was moved to the current `deft-reversi` repository. The archived repository and the
current repository therefore should not be treated as having the same license.

No source code from either repository has been intentionally copied into Cube Reversi.

## ccurro/othelloAI

**Project:** Othello - with an AI!  
**Repository:** https://github.com/ccurro/othelloAI

This project was consulted for minimax/alpha-beta search, iterative deepening,
killer-heuristic move ordering, near-endgame search, opening databases, and
established Othello evaluation concepts including mobility, potential mobility,
corners, stability, parity, C-squares, X-squares, and square-specific evaluation.

This project was used as a research and design reference rather than as a
source-code dependency.

No source code from `ccurro/othelloAI` has been intentionally copied into Cube
Reversi.

The repository's current public page does not provide a clearly identified
open-source license in its repository metadata. Accordingly, this notice does not
claim a particular license for that project. Its repository should be consulted for
its current terms before any source code or other copyrightable material is reused.

## Otto Othello

**Project:** Otto Othello  
**Author/Repository:** eigenfoo  
**Repository:** https://github.com/eigenfoo/otto-othello  
**License:** MIT License

Otto Othello was consulted for minimax/alpha-beta search, iterative deepening,
near-endgame complete search, phase-dependent evaluation, mobility, potential
mobility, stability, parity, disc difference, and square-weight concepts.

No Otto Othello source code has been intentionally copied into Cube Reversi.

## British Othello Federation

**Organization:** British Othello Federation  
**Strategy resources:** https://www.britishothello.org/strategy/

The British Othello Federation's publicly available strategy material was consulted
for human Othello strategy, particularly frontier discs and walls, quiet and loud
moves, edge play, edge tempo, unbalanced edges, corner access, wedges, and related
edge tactics.

This material was used as a gameplay and strategy reference, not as software code.

The Federation's strategy pages identify portions of their material as adaptations of
Brian Rose's *Othello: A Minute to Learn, a Lifetime to Master*, with permission from
Brian Rose. The Federation's own attribution should therefore remain associated with
any specific material quoted or reproduced from those pages. Cube Reversi does not
reproduce those pages or their diagrams.

## Othello Belgium

**Organization:** Othello Belgium  
**Strategy resources:** https://fr.othellobelgium.be/leer-othello/tips-en-strategie

Othello Belgium's strategy material was consulted for edge strategy, wedges,
unbalanced edges, and the relationship between edge play and corner access.

This material was used as a gameplay and strategy reference, not as software code.

## General Othello/Reversi Research

Cube Reversi also draws on the broader body of established Othello/Reversi
knowledge concerning:

- minimax and Negamax search
- alpha-beta pruning
- iterative deepening
- transposition tables
- move ordering
- mobility and potential mobility
- frontier discs and walls
- corners and C/X-square risk
- stability
- parity
- edge play and tempo
- pattern-based evaluation
- endgame solving

These are established concepts in computer game search and Othello strategy and are
not claimed as proprietary to any one project.

## Relationship to the Cube Reversi Implementation

The Cube Reversi code is independently written. The external projects and resources
above were consulted to understand established techniques and to compare possible
approaches while designing and testing the Cube Reversi Bot.

If future versions of Cube Reversi directly incorporate source code, data, opening
books, or other copyrightable material from an external project, this file should be
updated with the applicable copyright notice, license text or required notice, and
any other attribution required by that project's license before that material is
distributed.
