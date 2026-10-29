# CubeReversi

A browser-based 3D implementation of the classic game Reversi played on a cube, supporting 4x4x4, 6x6x6, and 8x8x8 boards, along with a dedicated Classic 8x8 mode and a Bot opponent.

The current version is 2.0.9. The live game is at https://cubereversi.com.




## To run it:

Download the repository and open index.html in a web browser.

Browsers block the game's scripts when index.html is opened directly from a file, so serve it from a simple local web server: in the repository folder, run `python3 -m http.server`, then open http://localhost:8000. The 3D view needs an internet connection, because three.js loads from unpkg.

CubeReversi.js is the authoritative game controller. It manages game state, rules, legal moves, board interaction, rendering, and move commitment.

CubeReversiBot.js contains the Bot engine. The Bot evaluates the current position and selects a move, while the game controller remains responsible for actually committing that move to the game state.




## Features

- 3D Cube Reversi boards in three sizes:
  - 4x4x4
  - 6x6x6
  - 8x8x8
- Classic 8×8 Reversi mode
- Human vs. Human and Human vs. Bot play
- Dedicated Bot with configurable search and evaluation
- Bot difficulty levels: Easy, Medium, and Hard, with a thinking-time setting
- Bot vs Bot mode:
  - Level and thinking time for each Bot
  - Pause and resume
  - Automatic next-game countdown
  - Win tally
  - Bots swap colors each game
- Opening book for Classic and cube openings, plus an Opening Book (PDF) study guide
- Rewind in Bot vs Bot, to look back through moves and return to the live game
- 3D board interaction and camera controls
- Coordinate-based move entry
- Move history and game-state tracking
- Legal-move highlighting
- Multiple board and display controls
- Browser-based implementation with no installation required
- Open-source, feedback and contributions welcome




## Status: Active development

The game itself is functional, but the strategic strength of the Bot is still under development. 




## AI Assistance

Cube Reversi was developed with substantial assistance from AI coding and reasoning systems. AI tools were used for brainstorming, code generation, debugging, architectural discussion, testing strategies, and analysis of Reversi positions.

AI-generated suggestions were reviewed, tested, modified, and integrated by the project author. The project author is responsible for the final code and implementation.

AI systems used during development include:
OpenAI ChatGPT — primary assistance for the earlier versions.
Grok Bot, an AI assistant — later versions (through 2.0.9). Grok Bot used Cursor cloud agents for coding and commits. This covered the 3D cube opening book, the study PDF, Bot vs Bot, bot level tuning and self-play testing, and UI updates.




## Research and Acknowledgements

The development of Cube Reversi and its computer opponent has been informed by
publicly available Othello/Reversi software, documentation, strategy resources,
and research.

Research references include Othello-Sensei, Deft Reversi, ccurro/othelloAI,
Otto Othello, the British Othello Federation, Othello Belgium, and other
public Othello/Reversi resources.

Classic opening names were also checked against the weltyc/othello openings
list, Edax's opening.c list, and the French Federation of Othello opening
page.

Peter Alfeld's 3D Reversi pages (University of Utah) were a reference for
Reversi played on a cube.

These projects and resources were consulted as research and design references.
The Cube Reversi implementation is independently written.

See Third_Party_Notices.md for the detailed list of
research references, licenses, and attribution information.




## Contributions

Cube Reversi is an active open-source project and contributions are welcome. Suggestions, bug reports, improvements to the game engine, UI, 3D implementation, Bot search, evaluation, testing, documentation, and research are all welcome.
If proposing changes to the Bot, please include testing or benchmark results where practical. Strategic changes are particularly useful when they can be demonstrated with reproducible positions or games.




## License

Cube Reversi is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

See LICENSE for the complete license text.




## Contact

Chris Dubendorf

chris@cubereversi.com

@ChrisDubendorf
