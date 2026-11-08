// Cube Reversi app version. This is the only copy.
//
// Saved games, the splash label, and worker results read APP_VERSION from here.
// These files cannot import a module, so they repeat the string and must agree:
//   index.html and the .js import URLs (?v=)
//   version.json
//   manifest.json "version"
//   a service-worker cache name, if one is added
//
// To bump: change APP_VERSION below, then set the same string in those static
// spots. Files in this public repo live at the repository root. This repo does
// not include tools/check-version.mjs.
export const APP_VERSION = '2.0.19';
