import * as THREE from 'three';
import { ArcballControls } from 'three/addons/controls/ArcballControls.js';
import { chooseMove } from './CubeReversiBot.js';

/*
 * Cube Reversi 1.28.23
 *
 * Multi-size board release:
 * - 4×4×4, 6×6×6, 8×8×8, or 8×8×1 Classic board
 * - 4×4×4 remains the default
 * - 8×8×1 Classic uses the standard four-piece Reversi opening
 * - Classic starts with a straight-on orthogonal view and a 2D corner guide
 * - 8 starting spheres in the central 2×2×2 block on 3D boards
 * - 26 possible capture directions (8 effective directions on Classic)
 * - optional green occupied-cell surfaces
 * - optional blue legal-move surfaces with golden hover highlighting
 * - black/white spheres represent pieces
 * - click a legal cube to play
 * - drag to rotate; wheel/pinch to zoom
 * - keyboard view and display controls
 * - separate Bot Engine for move selection
 *
 * Reversi.js remains the authoritative game controller: it owns game state,
 * rules, legal-move generation, rendering, turn management, history, and
 * committing moves. CubeReversiBot.js selects from moves supplied by this file
 * and does not directly mutate authoritative game state.
 */

let SIZE = 4;
let BOARD_DEPTH = 4;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const spacing = 1.25;
let boardOffset = (SIZE - 1) / 2;
let boardOffsetZ = (BOARD_DEPTH - 1) / 2;
const MOBILE_CAMERA_SCALE = 1.35;
let blackScore = 4;
let whiteScore = 4;

function isMobileViewport() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function setInitialCameraPosition() {
  const scale = isMobileViewport() ? MOBILE_CAMERA_SCALE : 1;

  // Version 1.25.4: Classic 8×8×1 remains orthogonal and starts about 33%
  // farther from the board than 1.25.3. resetView() uses this same function,
  // so R returns Classic mode to this exact zoom and orientation.
  if (BOARD_DEPTH === 1) {
    const distance = 17.024 * scale;
    // Version 1.27.12: Classic remains logically 2D, but the visual camera
    // is given a small fixed elevation so the six-face occupied cube shells
    // have visible depth instead of appearing as flat front-facing planes.
    // This is a Classic-only visual change; the logical board and coordinates
    // remain 8×8×1 and A–H / 1–8.
    const elevation = distance * 0.18;
    const depth = Math.sqrt(Math.max(0, distance * distance - elevation * elevation));
    camera.position.set(0, -elevation, depth);
    return;
  }

  const base = 7.2 + (SIZE - 4) * 1.4;
  camera.position.set(base * scale, (base - 1) * scale, base * scale);
}

const startOverlay = document.getElementById('startOverlay');
const startGameButton = document.getElementById('startGameButton');
const startLoadSequenceButton = document.getElementById('startLoadSequenceButton');
const gameDurationLabel = document.getElementById('gameDurationLabel');
const gameDurationSelect = document.getElementById('gameDuration');
const gameDurationNote = document.getElementById('gameDurationNote');
const colorFieldset = document.getElementById('colorFieldset');
const opponentModeInputs = document.querySelectorAll('input[name="opponentMode"]');
const sceneElement = document.getElementById('scene');
const versionLabel = document.getElementById('versionLabel');
const turnLabel = document.getElementById('turnLabel');
const playingAsLabel = document.getElementById('playingAsLabel');
const turnText = document.getElementById('turnText');
const turnMoveCount = document.getElementById('turnMoveCount');
const passOverlay = document.getElementById('passOverlay');
const passMessage = document.getElementById('passMessage');
const scoreLabel = document.getElementById('scoreLabel');
const emptySpacesLabel = document.getElementById('emptySpacesLabel');
const blackClockLabel = document.getElementById('blackClockLabel');
const whiteClockLabel = document.getElementById('whiteClockLabel');
const clockPanel = document.getElementById('clockPanel');
const resetButton = document.getElementById('resetButton');
const brandTitle = document.getElementById('brandTitle');
const brandLogo = document.getElementById('brandLogo');
const resignButton = document.getElementById('resignButton');
const resignConfirmOverlay = document.getElementById('resignConfirmOverlay');
const confirmResignButton = document.getElementById('confirmResignButton');
const gameEndConfirmOverlay = document.getElementById('gameEndConfirmOverlay');
const loadedSequenceChoiceOverlay = document.getElementById('loadedSequenceChoiceOverlay');
const loadedSequenceChoiceContinue = document.getElementById('loadedSequenceChoiceContinue');
const loadedBotDifficultyFieldset = document.getElementById('loadedBotDifficultyFieldset');
const botDifficultyLabel = document.getElementById('botDifficultyLabel');
const developerModeToggle = document.getElementById('developerModeToggle');
const bookOpeningsToggle = document.getElementById('bookOpeningsToggle');
const bookOpeningLabel = document.getElementById('bookOpeningLabel');
const botDeveloperPanel = document.getElementById('botDeveloperPanel');
const botDeveloperOutput = document.getElementById('botDeveloperOutput');
const copyBotDeveloperButton = document.getElementById('copyBotDeveloperButton');
const loadedPlayerModeInputs = document.querySelectorAll('input[name="loadedPlayerMode"]');
const loadedBotDifficultyInputs = document.querySelectorAll('input[name="loadedBotDifficulty"]');
const gameEndConfirmMessage = document.getElementById('gameEndConfirmMessage');
const confirmGameEndButton = document.getElementById('confirmGameEndButton');
const cancelGameEndButton = document.getElementById('cancelGameEndButton');
const cancelResignButton = document.getElementById('cancelResignButton');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const moveSequenceButton = document.getElementById('moveSequenceButton');
const loadSequenceButton = document.getElementById('loadSequenceButton');
const loadSequenceOverlay = document.getElementById('loadSequenceOverlay');
const loadSequencePanel = document.getElementById('loadSequencePanel');
const loadSequenceInput = document.getElementById('loadSequenceInput');
const loadSequenceError = document.getElementById('loadSequenceError');
const loadSequenceButtonConfirm = document.getElementById('loadSequenceButtonConfirm');
const cancelLoadSequenceButton = document.getElementById('cancelLoadSequenceButton');
const helpOverlay = document.getElementById('helpOverlay');
const helpPanel = document.getElementById('helpPanel');
const sequenceOverlay = document.getElementById('sequenceOverlay');
const moveSequence = document.getElementById('moveSequence');
const copySequenceButton = document.getElementById('copySequenceButton');
const closeSequenceButton = document.getElementById('closeSequenceButton');
const autoRotateToggle = document.getElementById('autoRotateToggle');
const show3AxisToggle = document.getElementById('show3AxisToggle');
const bluePulseToggle = document.getElementById('bluePulseToggle');
const blueCubesToggle = document.getElementById('blueCubesToggle');
const showWireframeToggle = document.getElementById('showWireframeToggle');
const hideGreenCubesToggle = document.getElementById('hideGreenCubesToggle');
const moveEntry = document.getElementById('moveEntry');
const moveCoordinateInput = document.getElementById('moveCoordinate');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e382b);

const camera = new THREE.PerspectiveCamera(
  42,
  sceneElement.clientWidth / sceneElement.clientHeight,
  0.1,
  100
);
setInitialCameraPosition();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0x0e382b, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(sceneElement.clientWidth, sceneElement.clientHeight);
sceneElement.appendChild(renderer.domElement);

const controls = new ArcballControls(camera, renderer.domElement, scene);
// Version 1.10.3: keep ArcballControls rotation but hide its on-screen
// trackball gizmos. Pan/focus/grid remain off; zoom remains enabled.
controls.enableRotate = true;
controls.enablePan = false;
controls.enableZoom = true;
controls.enableFocus = false;
controls.enableGizmos = false;
controls.setGizmosVisible(false);
controls.enableGrid = false;
controls.enableAnimations = true;
controls.minDistance = 5;
controls.maxDistance = 18;
controls.target.set(0, 0, 0);
controls.update();

function updateControlDistanceLimits() {
  controls.minDistance = 5 + (SIZE - 4) * 0.8;
  controls.maxDistance = 18 + (SIZE - 4) * 3;
}

updateControlDistanceLimits();

scene.add(new THREE.HemisphereLight(0xddeeff, 0x20252a, 2.0));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(5, 8, 7);
scene.add(keyLight);

const cubeGroup = new THREE.Group();
scene.add(cubeGroup);

// Version 1.22.29: the optional wireframe now shows only the twelve outer
// edges of the board bounding box, rather than the full internal cell grid. It is
// visual-only and is not a raycasting target.
const wireframeGroup = new THREE.Group();
wireframeGroup.visible = false;
cubeGroup.add(wireframeGroup);
const wireframeMaterial = new THREE.LineBasicMaterial({
  color: 0x39a96b,
  transparent: true,
  opacity: 0.72,
  depthTest: true,
  depthWrite: false
});

function rebuildWireframe() {
  for (const child of wireframeGroup.children) {
    wireframeGroup.remove(child);
    child.geometry.dispose();
  }

  const width = SIZE * spacing;
  const depth = BOARD_DEPTH * spacing;
  const geometry = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(width, width, depth)
  );
  const lines = new THREE.LineSegments(geometry, wireframeMaterial);
  lines.renderOrder = 2;
  wireframeGroup.add(lines);
}

function updateWireframeVisibility() {
  wireframeGroup.visible = showWireframeToggle.checked;
  requestRender();
}

rebuildWireframe();
// Version 1.25.1: apply the initial Wireframe checkbox state here without
// requesting a render before the render-on-demand state is initialized.
wireframeGroup.visible = showWireframeToggle.checked;

// Version 1.7.7: the original glossy dark green orientation sphere is the
// default orientation marker at the A-1-W corner. The optional 3-Axis
// view below provides the three colored edge alternative.
const orientationMarkerGeometry = new THREE.SphereGeometry(0.14, 24, 16);
const orientationMarkerMaterial = new THREE.MeshStandardMaterial({
  color: 0x174d2a,
  roughness: 0.28,
  metalness: 0.05
});
const mainOrientationMarker = new THREE.Mesh(
  orientationMarkerGeometry,
  orientationMarkerMaterial
);
let boardHalfExtent = boardOffset * spacing + 0.625;
mainOrientationMarker.position.set(
  -boardHalfExtent,
  -boardHalfExtent,
  -boardHalfExtent
);
cubeGroup.add(mainOrientationMarker);

function update3AxisVisibility() {
  const show3Axis = show3AxisToggle.checked;
  orientationEdges.visible = show3Axis;
}

function updateOrientationMarkerVisibility() {
  const show3Axis = show3AxisToggle.checked;
  mainOrientationMarker.visible = !isMobileViewport() && !show3Axis;
  update3AxisVisibility();
}

// Optional three-axis alternative. Hidden by default; the sidebar toggle
// switches between this view and the original green orientation sphere.
const orientationEdgeMaterials = {
  // Keep the three-axis guide visible over the transparent board surfaces so
  // resetting/starting a new game cannot visually bury it inside the cube.
  x: new THREE.LineBasicMaterial({ color: 0xe06b6b, depthTest: false, depthWrite: false }),
  y: new THREE.LineBasicMaterial({ color: 0x65b96e, depthTest: false, depthWrite: false }),
  z: new THREE.LineBasicMaterial({ color: 0x6f9ee8, depthTest: false, depthWrite: false })
};
const orientationEdges = new THREE.Group();
orientationEdges.visible = false;

function addOrientationEdge(axis, material) {
  const halfX = boardHalfExtent;
  const halfY = boardHalfExtent;
  const halfZ = boardOffsetZ * spacing + 0.625;
  const start = new THREE.Vector3(-halfX, -halfY, -halfZ);
  const end = start.clone();
  end[axis] = axis === 'x' ? halfX : axis === 'y' ? halfY : halfZ;
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  orientationEdges.add(new THREE.Line(geometry, material));
}

function rebuildOrientationEdges() {
  while (orientationEdges.children.length) {
    const child = orientationEdges.children[orientationEdges.children.length - 1];
    orientationEdges.remove(child);
    child.geometry.dispose();
  }
  addOrientationEdge('x', orientationEdgeMaterials.x);
  addOrientationEdge('y', orientationEdgeMaterials.y);
  addOrientationEdge('z', orientationEdgeMaterials.z);
}

rebuildOrientationEdges();
cubeGroup.add(orientationEdges);
updateOrientationMarkerVisibility();
// ---------------------------------------------------------------------------
// Coordinate-axis model — Version 1.6.1
// ---------------------------------------------------------------------------
// Board notation (size-dependent):
//   X axis: A B C D E F G H
//   Y axis: 1 2 3 4 5 6 7 8
//   Z axis: S T U V W X Y Z
//
// This is a visual orientation guide only. It does not alter board state,
// board coordinates, move validation, or game rules.
const coordinateAxesHost = document.getElementById('coordinateAxes');
const coordinateReadout = document.getElementById('coordinateReadout');

const axesScene = new THREE.Scene();

// Version 1.6.4: light the miniature model with the same scene-lighting setup
// needed by the shared MeshStandardMaterial used by both orientation markers.
const axesHemisphereLight = new THREE.HemisphereLight(0xddeeff, 0x20252a, 2.0);
axesScene.add(axesHemisphereLight);
const axesKeyLight = new THREE.DirectionalLight(0xffffff, 2.2);
axesKeyLight.position.set(5, 8, 7);
axesScene.add(axesKeyLight);

const axesCamera = new THREE.OrthographicCamera(
  -2.05, 2.05, 2.05, -2.05, 0.1, 20
);
axesCamera.position.set(0, 0, 7);
axesCamera.lookAt(0, 0, 0);

const axesRenderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true
});
axesRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
axesRenderer.setSize(290, 290, false);
coordinateAxesHost.appendChild(axesRenderer.domElement);

const axesGroup = new THREE.Group();
axesScene.add(axesGroup);

// Version 1.21.2: performance foundation — render on demand. The scene is no
// longer rendered continuously when nothing is changing. Continuous rendering
// is reserved for active visual animations such as Auto-Rotate and F flip.
let continuousRenderActive = false;
let renderScheduled = false;

function renderScene() {
  controls.update();

  const cameraOrientation = camera.quaternion.clone().invert();
  axesGroup.quaternion.copy(cameraOrientation).multiply(cubeGroup.quaternion);

  axesRenderer.render(axesScene, axesCamera);
  renderer.render(scene, camera);
}

function requestRender() {
  if (document.hidden || continuousRenderActive || renderScheduled) return;

  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    if (!document.hidden && !continuousRenderActive) {
      renderScene();
    }
  });
}

function startContinuousRendering() {
  if (document.hidden || continuousRenderActive) return;
  continuousRenderActive = true;
  renderer.setAnimationLoop(animate);
}

function stopContinuousRendering() {
  if (!continuousRenderActive) return;
  continuousRenderActive = false;
  renderer.setAnimationLoop(null);
  requestRender();
}

controls.addEventListener('change', requestRender);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Version 1.22.17: treat a hidden browser tab like the blue animation's
    // inactivity timeout. Stop the pulse immediately and require fresh user
    // interaction with the game to start it again.
    if (blueOpacityStopTimer !== null) {
      window.clearTimeout(blueOpacityStopTimer);
      blueOpacityStopTimer = null;
    }
    blueOpacityAnimationActive = false;
    if (legalSurface) {
      legalSurface.material.opacity = bluePulseToggle.checked
        ? BLUE_OPACITY_IDLE
        : getLegalSurfaceOpacity();
    }

    renderer.setAnimationLoop(null);
    continuousRenderActive = false;
    renderScheduled = false;
    return;
  }

  requestRender();
  // Auto-Rotate and flip animation retain their existing visibility behavior.
  // The blue legal-move pulse remains stopped until the user interacts.
  if (flipAnimationActive || (autoRotateEnabled && !hoveringOverCube)) {
    startContinuousRendering();
  }
});

// Version 1.6.4: retain the visual center of the coordinate model as its
// rotation pivot while preserving the model's existing screen position.
const axesModelCenter = 0.71;
const axesContent = new THREE.Group();
axesContent.position.set(-axesModelCenter, -axesModelCenter, -axesModelCenter);
axesGroup.add(axesContent);

// Version 1.6.4: matching glossy dark green orientation marker at the miniature model's
// origin, corresponding to the A-1-W corner of the main board.
const miniOrientationMarkerGeometry = new THREE.SphereGeometry(0.09, 24, 16);
const miniOrientationMarker = new THREE.Mesh(
  miniOrientationMarkerGeometry,
  orientationMarkerMaterial
);
// Version 1.25.7: the synchronized Classic guide retains its matching
// coordinate orientation. Version 1.25.8 moves only the main-board
// orientation marker to the bottom-left so it matches this guide's
// synchronized motion while leaving the A–H / 1–8 labels unchanged.
miniOrientationMarker.position.set(0, BOARD_DEPTH === 1 ? 1.44 : 0, 0);
axesContent.add(miniOrientationMarker);
axesGroup.position.set(axesModelCenter, axesModelCenter, axesModelCenter);

const axisColors = {
  x: 0xe06b6b,
  y: 0x65b96e,
  z: 0x6f9ee8
};

const coordinateAxisArrows = {};

function addCoordinateAxis(axisName, direction, color) {
  const arrow = new THREE.ArrowHelper(
    direction.clone().normalize(),
    new THREE.Vector3(0, 0, 0),
    1.55,
    color,
    0.18,
    0.08
  );
  coordinateAxisArrows[axisName] = arrow;
  axesContent.add(arrow);
}

addCoordinateAxis('x', new THREE.Vector3(1, 0, 0), axisColors.x);
addCoordinateAxis('y', new THREE.Vector3(0, 1, 0), axisColors.y);
addCoordinateAxis('z', new THREE.Vector3(0, 0, 1), axisColors.z);

function updateCoordinateAxisVisibility() {
  // Version 1.25.5: Classic 8×8×1 is two-dimensional, so its synchronized
  // corner model shows only A–H and 1–8. The third/Z axis is omitted.
  // Version 1.27.12: Classic is visually given cube depth, but its synchronized
  // coordinate model remains strictly two-dimensional. Do not display the Z
  // axis or any Z coordinate in the Classic guide.
  coordinateAxisArrows.z.visible = BOARD_DEPTH !== 1;
}


// Miniature coordinate guide. Its geometry and labels are rebuilt for the
// selected board size so the guide continues to describe the active cube.
const miniCellSize = 0.36;
const miniCubeGroup = new THREE.Group();
axesContent.add(miniCubeGroup);

const miniCubeMaterial = new THREE.LineBasicMaterial({
  color: 0x87939b,
  transparent: true,
  opacity: 0.32,
  depthTest: false
});
const miniCubeEdges = [];
miniCubeGroup.visible = false;

const miniHighlightMaterial = new THREE.MeshBasicMaterial({
  color: 0xffff00,
  transparent: true,
  opacity: 0.15,
  side: THREE.DoubleSide,
  depthWrite: false,
  depthTest: false
});
const miniHighlightGeometry = new THREE.BoxGeometry(
  miniCellSize, miniCellSize, miniCellSize
);
const miniHighlightCube = new THREE.Mesh(
  miniHighlightGeometry,
  miniHighlightMaterial
);
miniHighlightCube.visible = false;
axesContent.add(miniHighlightCube);

let miniCellCenters = [];
let miniZCenters = [];
let coordinateLabels = [];
const xLabelLetters = 'ABCDEFGH';
const zLabelLetters = 'STUVWXYZ';

function disposeCoordinateLabels() {
  for (const sprite of coordinateLabels) {
    axesContent.remove(sprite);
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
  coordinateLabels = [];
}

function rebuildCoordinateGuide() {
  disposeCoordinateLabels();

  while (miniCubeGroup.children.length) {
    const child = miniCubeGroup.children[miniCubeGroup.children.length - 1];
    miniCubeGroup.remove(child);
    child.geometry.dispose();
  }
  miniCubeEdges.length = 0;

  const start = SIZE === 4 ? 0.34 : 0.18;
  const end = SIZE === 4 ? 1.42 : 1.44;
  const step = SIZE === 1 ? 0 : (end - start) / (SIZE - 1);
  miniCellCenters = Array.from({ length: SIZE }, (_, i) => start + i * step);
  const miniZStart = BOARD_DEPTH === 1 ? 0 : start;
  const miniZEnd = BOARD_DEPTH === 1 ? 0 : end;
  const miniZStep = BOARD_DEPTH === 1 ? 0 : (miniZEnd - miniZStart) / (BOARD_DEPTH - 1);
  miniZCenters = Array.from({ length: BOARD_DEPTH }, (_, i) => miniZStart + i * miniZStep);

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        const geometry = new THREE.EdgesGeometry(
          new THREE.BoxGeometry(miniCellSize, miniCellSize, miniCellSize)
        );
        const line = new THREE.LineSegments(geometry, miniCubeMaterial);
        const visualMiniY = BOARD_DEPTH === 1 ? miniCellCenters[SIZE - 1 - y] : miniCellCenters[y];
        line.position.set(miniCellCenters[x], visualMiniY, miniZCenters[z]);
        miniCubeGroup.add(line);
        miniCubeEdges.push(line);
      }
    }
  }

  const makeLabel = (text, position, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    context.font = 'bold 36px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 64, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(0.58, 0.29, 1);
    axesContent.add(sprite);
    coordinateLabels.push(sprite);
  };

  for (let i = 0; i < SIZE; i++) {
    makeLabel(xLabelLetters[i], new THREE.Vector3(miniCellCenters[i], 0, 0), axisColors.x);
    const visualLabelY = BOARD_DEPTH === 1 ? miniCellCenters[SIZE - 1 - i] : miniCellCenters[i];
    makeLabel(String(i + 1), new THREE.Vector3(0, visualLabelY, 0), axisColors.y);
  }
  if (BOARD_DEPTH !== 1) {
    for (let i = 0; i < BOARD_DEPTH; i++) {
      makeLabel(zLabelLetters[i], new THREE.Vector3(0, 0, miniZCenters[i]), axisColors.z);
    }
  }
}

rebuildCoordinateGuide();
updateCoordinateAxisVisibility();

function coordinateNotation(x, y, z) {
  // Version 1.28.16: Classic move notation is strictly two-dimensional.
  // The internal z=0 layer remains authoritative, but Classic move sequences
  // must not expose that implementation detail as a third coordinate.
  if (BOARD_DEPTH === 1) {
    return `${xLabelLetters[x]} - ${y + 1}`;
  }
  return `${xLabelLetters[x]} - ${y + 1} - ${zLabelLetters[z]}`;
}

function updateCoordinateGuideHighlight() {
  if (!highlightedLegalKey) {
    miniHighlightCube.visible = false;
    coordinateReadout.textContent = '';
    return;
  }

  const [x, y, z] = highlightedLegalKey.split(',').map(Number);
  const visualMiniY = BOARD_DEPTH === 1 ? miniCellCenters[SIZE - 1 - y] : miniCellCenters[y];
  miniHighlightCube.position.set(
    miniCellCenters[x],
    visualMiniY,
    miniZCenters[z]
  );
  miniHighlightCube.visible = true;
  // Version 1.25.12: Classic 8×8×1 does not use a Z-axis coordinate,
  // so its on-screen coordinate readout shows only the A–H / 1–8 pair.
  coordinateReadout.textContent = BOARD_DEPTH === 1
    ? `${xLabelLetters[x]} - ${y + 1}`
    : coordinateNotation(x, y, z);
}

let board = Array.from({ length: SIZE }, () =>
  Array.from({ length: SIZE }, () =>
    Array(BOARD_DEPTH).fill(EMPTY)
  )
);

const cellMeshes = new Map();
const pieceMeshes = new Map();
let currentLegalKeys = new Set();
let highlightedLegalKey = null;
let occupiedSurface = null;
let legalSurface = null;
let legalHighlightSurface = null;
let lastMoveMarker = null;
let lastMoveMarkerKey = null;

const directions = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        directions.push([dx, dy, dz]);
      }
    }
  }
}

let currentPlayer = BLACK;
let passMessageActive = false;
let passPlayer = null;
let gameCompleteActive = false;
let gameInProgress = false;
let pendingGameEndAction = null;
let moveSequenceHistory = [];
let undoHistory = [];
let redoHistory = [];
let historyReviewActive = false;

// Version 1.13.1: bot plumbing repairs. The bot may enter playMove() through
// the internal bot-move path while human input remains blocked during bot turns.
let opponentMode = 'bot';
let humanPlayer = BLACK;
let gameDuration = '5';
let botDifficulty = 'medium';
let developerMode = false;
let bookOpeningsEnabled = true;
let botDeveloperEntries = [];
let botDeveloperGameStartedAt = null;

// Version 1.12.3: per-player game clocks. Remaining time is stored independently
// for each color; the active player's elapsed time is calculated from
// performance.now() so browser timer throttling does not make the clock drift.
let clockRemainingMs = { BLACK: 5 * 60 * 1000, WHITE: 5 * 60 * 1000 };
let clockTurnStartedAt = null;
let clockRunning = false;
let timeoutHandled = false;
let gameClockTicker = null;
let botMoveTimer = null;

function key(x, y, z) {
  return `${x},${y},${z}`;
}

function worldPosition(x, y, z) {
  // Version 1.25.6: Classic 8×8×1 uses the established Reversi coordinate
  // orientation, with row 1 at the top while A remains on the left. The
  // underlying board coordinates stay unchanged so rules/history are stable.
  const visualY = BOARD_DEPTH === 1 ? (SIZE - 1 - y) : y;
  return new THREE.Vector3(
    (x - boardOffset) * spacing,
    (visualY - boardOffset) * spacing,
    (z - boardOffsetZ) * spacing
  );
}

function inside(x, y, z) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE && z >= 0 && z < BOARD_DEPTH;
}

function opponent(player) {
  return player === BLACK ? WHITE : BLACK;
}

function isLegalMove(x, y, z, player) {
  if (board[x][y][z] !== EMPTY) return false;

  const other = opponent(player);

  for (const [dx, dy, dz] of directions) {
    let cx = x + dx;
    let cy = y + dy;
    let cz = z + dz;
    let foundOpponent = false;

    while (inside(cx, cy, cz) && board[cx][cy][cz] === other) {
      foundOpponent = true;
      cx += dx;
      cy += dy;
      cz += dz;
    }

    if (
      foundOpponent &&
      inside(cx, cy, cz) &&
      board[cx][cy][cz] === player
    ) {
      return true;
    }
  }

  return false;
}

function getFlips(x, y, z, player) {
  const flips = [];
  const other = opponent(player);

  for (const [dx, dy, dz] of directions) {
    const line = [];
    let cx = x + dx;
    let cy = y + dy;
    let cz = z + dz;

    while (inside(cx, cy, cz) && board[cx][cy][cz] === other) {
      line.push([cx, cy, cz]);
      cx += dx;
      cy += dy;
      cz += dz;
    }

    if (
      line.length &&
      inside(cx, cy, cz) &&
      board[cx][cy][cz] === player
    ) {
      flips.push(...line);
    }
  }

  return flips;
}

function legalMoves(player) {
  const moves = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        if (isLegalMove(x, y, z, player)) {
          moves.push([x, y, z]);
        }
      }
    }
  }
  return moves;
}

// Analyze a candidate move without permanently changing the game state.
// The bot engine receives this authoritative mobility count as evaluation data.
function countOpponentMovesAfterMove(move, player, flips) {
  const savedBoard = board.map((plane) =>
    plane.map((row) => row.slice())
  );

  board[move[0]][move[1]][move[2]] = player;
  for (const [x, y, z] of flips) {
    board[x][y][z] = player;
  }

  const opponentPlayer = opponent(player);
  const opponentMovesList = legalMoves(opponentPlayer);
  const opponentMoves = opponentMovesList.length;
  const ownMoves = legalMoves(player).length;
  const opponentSurfaceMoves = opponentMovesList.filter(
    (candidate) => getSurfaceLevel(candidate) > 0
  ).length;
  board = savedBoard;
  return { opponentMoves, ownMoves, opponentSurfaceMoves };
}

function isBotTurn() {
  return opponentMode === 'bot' && currentPlayer !== humanPlayer && !gameCompleteActive && !historyReviewActive;
}

function getSurfaceLevel(move) {
  let level = 0;
  if (move[0] === 0 || move[0] === SIZE - 1) level++;
  if (move[1] === 0 || move[1] === SIZE - 1) level++;
  if (move[2] === 0 || move[2] === BOARD_DEPTH - 1) level++;
  return level;
}

// 1.18.16: corner awareness now applies to every supported board size.
// A true corner is strongly preferred while it is available. A move adjacent
// to an unclaimed or opponent-owned corner is discouraged, but once a corner
// belongs to the bot, adjacent moves become favorable so the bot can build
// outward from its secured corner. This same logic is now tested on 4×4×4,
// where corners are available very early and the user observed the bot
// avoiding them.
function getCornerPosition(move, player) {
  let best = 0;
  for (const cx of [0, SIZE - 1]) {
    for (const cy of [0, SIZE - 1]) {
      for (const cz of [0, BOARD_DEPTH - 1]) {
        const dx = Math.abs(move[0] - cx);
        const dy = Math.abs(move[1] - cy);
        const dz = Math.abs(move[2] - cz);
        const distance = Math.max(dx, dy, dz);
        if (distance === 0) return 3;
        if (distance === 1) {
          const cornerValue = board[cx][cy][cz];
          if (cornerValue === player) {
            best = Math.max(best, 2);
          } else {
            best = Math.min(best, -2);
          }
        }
      }
    }
  }
  return best;
}

function updateBotDeveloperPanel() {
  if (!botDeveloperPanel || !botDeveloperOutput) return;
  botDeveloperPanel.hidden = !developerMode || opponentMode !== 'bot';
  if (!developerMode || opponentMode !== 'bot') return;

  const boardLabel = BOARD_DEPTH === 1 ? '8×8×1 Classic' : `${SIZE}×${SIZE}×${BOARD_DEPTH}`;
  const lines = [
    `Cube Reversi Bot Developer Summary — Version 1.28.23`,
    `Board: ${boardLabel}`,
    `Difficulty: ${botDifficulty.charAt(0).toUpperCase()}${botDifficulty.slice(1)}`,
    `Browser: ${navigator.userAgent}`,
    `Moves recorded: ${botDeveloperEntries.length}`,
    ''
  ];

  if (botDeveloperEntries.length) {
    lines.push('Move | Color | Coordinate | Source | Opening | Time (ms) | Depth | Target | Nodes | Leaves | Cutoffs | TT');
    for (const entry of botDeveloperEntries) {
      const source = entry.source || 'SEARCH';
      const opening = entry.bookName || '';
      lines.push(`${entry.moveNumber} | ${entry.color} | ${entry.coordinate} | ${source} | ${opening} | ${entry.timeMs} | ${entry.depth} | ${entry.targetDepth} | ${entry.nodes} | ${entry.leaves} | ${entry.cutoffs} | ${entry.tableEntries}`);
    }
    const totalMs = botDeveloperEntries.reduce((sum, entry) => sum + entry.timeMs, 0);
    const averageMs = totalMs / botDeveloperEntries.length;
    const averageDepth = botDeveloperEntries.reduce((sum, entry) => sum + entry.depth, 0) / botDeveloperEntries.length;
    lines.push('');
    lines.push(`Total Bot search time: ${totalMs.toFixed(1)} ms`);
    lines.push(`Average Bot move time: ${averageMs.toFixed(1)} ms`);
    lines.push(`Average completed depth: ${averageDepth.toFixed(2)}`);
  } else {
    lines.push('No Bot moves recorded yet.');
  }

  botDeveloperOutput.value = lines.join('\n');
}

function resetBotDeveloperSummary() {
  botDeveloperEntries = [];
  botDeveloperGameStartedAt = performance.now();
  updateBotDeveloperPanel();
}

async function copyBotDeveloperSummary() {
  if (!botDeveloperOutput) return;
  try {
    await navigator.clipboard.writeText(botDeveloperOutput.value);
    const original = copyBotDeveloperButton.textContent;
    copyBotDeveloperButton.textContent = 'Copied';
    window.setTimeout(() => { copyBotDeveloperButton.textContent = original; }, 1200);
  } catch {
    botDeveloperOutput.focus();
    botDeveloperOutput.select();
  }
}

function scheduleBotTurn() {
  if (!isBotTurn() || passMessageActive || botMoveTimer !== null) return;

  botMoveTimer = setTimeout(() => {
    botMoveTimer = null;
    if (!isBotTurn() || passMessageActive) return;

    const moves = legalMoves(currentPlayer);
    if (!moves.length) {
      const otherPlayer = opponent(currentPlayer);
      const otherMoves = legalMoves(otherPlayer);
      if (otherMoves.length) {
        moveSequenceHistory.push('PASS');
        updateMoveSequenceDisplay();
        showPassMessage(currentPlayer);
        switchClockToCurrentPlayer();
      } else {
        showGameComplete();
      }
      return;
    }

    const moveOptions = moves.map((move) => {
      const flips = getFlips(move[0], move[1], move[2], currentPlayer);
      const mobility = countOpponentMovesAfterMove(move, currentPlayer, flips);
      return {
        move,
        flips: flips.length,
        opponentMoves: mobility.opponentMoves,
        ownMoves: mobility.ownMoves,
        opponentSurfaceMoves: mobility.opponentSurfaceMoves,
        surfaceLevel: getSurfaceLevel(move),
        cornerPosition: getCornerPosition(move, currentPlayer)
      };
    });

    const botSearchStartedAt = performance.now();
    const move = chooseMove(moveOptions, {
      boardSize: SIZE,
      boardDepth: BOARD_DEPTH,
      player: currentPlayer,
      difficulty: botDifficulty,
      board: board.map((plane) => plane.map((row) => row.slice()))
    });
    const botSearchTimeMs = performance.now() - botSearchStartedAt;
    const searchStats = chooseMove.lastSearchStats || {};

    if (developerMode) {
      botDeveloperEntries.push({
        moveNumber: moveSequenceHistory.length + 1,
        color: currentPlayer === BLACK ? 'Black' : 'White',
        coordinate: coordinateNotation(move[0], move[1], move[2]),
        timeMs: Number(botSearchTimeMs.toFixed(1)),
        depth: searchStats.completedDepth ?? 0,
        targetDepth: searchStats.targetDepth ?? 0,
        nodes: searchStats.nodes ?? 0,
        leaves: searchStats.leaves ?? 0,
        cutoffs: searchStats.cutoffs ?? 0,
        tableEntries: searchStats.tableEntries ?? 0,
        source: searchStats.source || 'SEARCH',
        bookName: searchStats.bookName || ''
      });
      updateBotDeveloperPanel();
    }

    playMove(move[0], move[1], move[2], true);
  }, 250);
}

function makeInitialPosition() {
  const low = SIZE / 2 - 1;
  const high = SIZE / 2;

  if (BOARD_DEPTH === 1) {
    // Version 1.28.12: restore the standard Classic Reversi opening
    // orientation: Black on E-4 and D-5; White on D-4 and E-5.
    board[low][low][0] = WHITE;
    board[low][high][0] = BLACK;
    board[high][low][0] = BLACK;
    board[high][high][0] = WHITE;
    return;
  }

  // Central 2×2×2 block: four black and four white on 3D boards.
  const start = [
    [low, low, low, BLACK],
    [low, low, high, WHITE],
    [low, high, low, WHITE],
    [low, high, high, BLACK],
    [high, low, low, WHITE],
    [high, low, high, BLACK],
    [high, high, low, BLACK],
    [high, high, high, WHITE]
  ];

  for (const [x, y, z, value] of start) {
    board[x][y][z] = value;
  }
}

function createCell(x, y, z) {
  const geometry = new THREE.BoxGeometry(1.25, 1.25, 1.25);
  const material = new THREE.MeshBasicMaterial({
    color: 0x8f9aa1,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(worldPosition(x, y, z));
  mesh.userData = { x, y, z, type: 'cell' };
  mesh.visible = false;

  cubeGroup.add(mesh);
  cellMeshes.set(key(x, y, z), mesh);
}

function createPiece(x, y, z, player) {
  const geometry = new THREE.SphereGeometry(0.43, 32, 20);
  const material = new THREE.MeshStandardMaterial({
    color: player === BLACK ? 0x101214 : 0xf1f1ec,
    roughness: 0.28,
    metalness: 0.05
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(worldPosition(x, y, z));
  mesh.userData = { x, y, z, type: 'piece' };
  cubeGroup.add(mesh);
  pieceMeshes.set(key(x, y, z), mesh);
}

function updatePieces() {
  for (const mesh of pieceMeshes.values()) {
    cubeGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  pieceMeshes.clear();

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        if (board[x][y][z] !== EMPTY) {
          createPiece(x, y, z, board[x][y][z]);
        }
      }
    }
  }
}

function buildOccupiedSurfaceGeometry() {
  const positions = [];
  const normals = [];

  const faces = [
    { d: [1, 0, 0], n: [1, 0, 0], c: [[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5],[0.5,-0.5,0.5]] },
    { d: [-1, 0, 0], n: [-1, 0, 0], c: [[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5],[-0.5,-0.5,-0.5]] },
    { d: [0, 1, 0], n: [0, 1, 0], c: [[-0.5,0.5,-0.5],[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5]] },
    { d: [0, -1, 0], n: [0, -1, 0], c: [[-0.5,-0.5,0.5],[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5]] },
    { d: [0, 0, 1], n: [0, 0, 1], c: [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]] },
    { d: [0, 0, -1], n: [0, 0, -1], c: [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]] }
  ];

  const half = 0.625;

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        if (board[x][y][z] === EMPTY) continue;

        const center = worldPosition(x, y, z);

        // Version 1.27.12: Classic uses the same complete six-face occupied
        // cube shell as the true 3D boards. The difference is visual only: the
        // Classic camera is slightly elevated so this shell has visible depth,
        // while the logical board remains BOARD_DEPTH === 1.
        const facesToRender = faces;

        for (const face of facesToRender) {
          const nx = x + face.d[0];
          const ny = y + face.d[1];
          const nz = z + face.d[2];

          const neighborOccupied =
            nx >= 0 && nx < SIZE &&
            ny >= 0 && ny < SIZE &&
            nz >= 0 && nz < BOARD_DEPTH &&
            board[nx][ny][nz] !== EMPTY;

          // Version 1.27.19: Classic intentionally keeps every face of every
          // occupied cube, including faces shared with another occupied cube.
          // Classic is a single logical z=0 layer, so these internal faces do
          // not hide any cubes behind the occupied structure. Keeping them
          // gives every occupied cell a complete closed cube surface while the
          // existing translucent material still allows the spheres to show.
          // True 3D boards retain the established shared-face omission.
          if (BOARD_DEPTH !== 1 && neighborOccupied) continue;

          const quad = face.c.map(([px, py, pz]) => [
            center.x + px * 2 * half,
            center.y + py * 2 * half,
            center.z + pz * 2 * half
          ]);

          for (const i of [0, 1, 2, 0, 2, 3]) {
            positions.push(...quad[i]);
            normals.push(...face.n);
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(normals, 3)
  );
  return geometry;
}

function updateOccupiedSurface() {
  if (occupiedSurface) {
    cubeGroup.remove(occupiedSurface);
    occupiedSurface.geometry.dispose();
    occupiedSurface.material.dispose();
  }

  // Version 1.27.19: restore the transparent occupied-surface renderer used
  // before the failed 1.27.17 opaque experiment. Classic remains logically
  // 8×8×1; its visual camera/synchronized-model behavior is unchanged.
  // No separate Classic material path is introduced here.
  const geometry = buildOccupiedSurfaceGeometry();
  const material = new THREE.MeshBasicMaterial({
    color: 0x39a96b,
    transparent: true,
    opacity: 0.50,
    side: THREE.DoubleSide,
    depthWrite: true,
    renderOrder: 0
  });

  occupiedSurface = new THREE.Mesh(geometry, material);
  occupiedSurface.visible = hideGreenCubesToggle.checked;
  cubeGroup.add(occupiedSurface);
  requestRender();
}

function buildSurfaceGeometryForCells(cellSet, excludedKey = null) {
  const positions = [];
  const normals = [];

  const faces = [
    { d: [1, 0, 0], n: [1, 0, 0], c: [[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5],[0.5,-0.5,0.5]] },
    { d: [-1, 0, 0], n: [-1, 0, 0], c: [[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5],[-0.5,-0.5,-0.5]] },
    { d: [0, 1, 0], n: [0, 1, 0], c: [[-0.5,0.5,-0.5],[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5]] },
    { d: [0, -1, 0], n: [0, -1, 0], c: [[-0.5,-0.5,0.5],[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5]] },
    { d: [0, 0, 1], n: [0, 0, 1], c: [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]] },
    { d: [0, 0, -1], n: [0, 0, -1], c: [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]] }
  ];

  const half = 0.625;

  for (const cellKey of cellSet) {
    if (cellKey === excludedKey) continue;

    const [x, y, z] = cellKey.split(',').map(Number);
    const center = worldPosition(x, y, z);

    for (const face of faces) {
      const neighborKey = key(
        x + face.d[0],
        y + face.d[1],
        z + face.d[2]
      );

      // Classic is a single logical layer, so its blue cubes intentionally
      // keep shared/internal faces to render as closed translucent cubes.
      // True 3D boards retain the established merged outer-shell behavior.
      if (BOARD_DEPTH !== 1 && cellSet.has(neighborKey)) continue;

      const quad = face.c.map(([px, py, pz]) => [
        center.x + px * 2 * half,
        center.y + py * 2 * half,
        center.z + pz * 2 * half
      ]);

      for (const i of [0, 1, 2, 0, 2, 3]) {
        positions.push(...quad[i]);
        normals.push(...face.n);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(normals, 3)
  );
  return geometry;
}

function updateLastMoveMarker() {
  if (lastMoveMarker) {
    cubeGroup.remove(lastMoveMarker);
    lastMoveMarker.geometry.dispose();
    lastMoveMarker.material.dispose();
    lastMoveMarker = null;
  }

  if (!lastMoveMarkerKey) return;

  const [x, y, z] = lastMoveMarkerKey.split(',').map(Number);
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.30, 1.30, 1.30));
  const material = new THREE.LineDashedMaterial({
    color: 0xffffff,
    dashSize: 0.16,
    gapSize: 0.10,
    transparent: true,
    opacity: 0.95
  });

  lastMoveMarker = new THREE.LineSegments(geometry, material);
  lastMoveMarker.position.copy(worldPosition(x, y, z));
  lastMoveMarker.computeLineDistances();
  cubeGroup.add(lastMoveMarker);
  requestRender();
}

function isAdjacentToUnoccupiedCorner(x, y, z) {
  // The orange corner warning is only a feature of the true 3D 6×6×6 and
  // 8×8×8 boards. Classic 8×8×1 is a flat Reversi board and never uses it.
  if (BOARD_DEPTH !== SIZE || (SIZE !== 6 && SIZE !== 8)) return false;

  // A 3D cube corner has 7 directly adjacent cells: the 3 edge neighbors,
  // 3 face-diagonal neighbors, and 1 body-diagonal neighbor. Test against
  // every corner so this works for both 6×6×6 and 8×8×8 coordinates without
  // hard-coding the coordinate values for either board size. The warning is
  // only useful while the adjacent corner itself is still empty.

  const last = SIZE - 1;
  for (const cx of [0, last]) {
    for (const cy of [0, last]) {
      for (const cz of [0, last]) {
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const dz = Math.abs(z - cz);
        if (dx <= 1 && dy <= 1 && dz <= 1 && (dx + dy + dz) > 0) {
          if (board[cx][cy][cz] === EMPTY) return true;
        }
      }
    }
  }

  return false;
}

function updateLegalHighlightSurface() {
  if (!highlightedLegalKey) {
    if (legalHighlightSurface) {
      legalHighlightSurface.visible = false;
    }
    updateCoordinateGuideHighlight();
    return;
  }

  const [x, y, z] = highlightedLegalKey.split(',').map(Number);
  // Version 1.25.5: keep one highlight mesh and move/update it instead of
  // removing and recreating the mesh on every pointermove. This prevents
  // rapid cursor movement from producing visible highlight flashes.
  if (!legalHighlightSurface) {
    const geometry = new THREE.BoxGeometry(1.25, 1.25, 1.25);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: false,
      opacity: 1.0,
      side: THREE.DoubleSide,
      depthWrite: true
    });
    legalHighlightSurface = new THREE.Mesh(geometry, material);
    // Keep the highlight exactly within the selected cube's bounds.
    legalHighlightSurface.scale.setScalar(1);
    cubeGroup.add(legalHighlightSurface);
  }

  // Version 1.25.5: orange-gold is used only for legal cubes adjacent to an
  // unoccupied corner on true 3D 6×6×6 and 8×8×8 boards. Classic 8×8×1
  // always uses the normal yellow highlight.
  const highlightColor = isAdjacentToUnoccupiedCorner(x, y, z) ? 0xffb000 : 0xffff00;
  legalHighlightSurface.material.color.setHex(highlightColor);
  legalHighlightSurface.position.copy(worldPosition(x, y, z));
  legalHighlightSurface.visible = true;
  updateCoordinateGuideHighlight();
}

function getLegalSurfaceOpacity() {
  const occupiedCount = board.flat(2).filter((value) => value !== EMPTY).length;
  const minimumOpacity = 0.10;
  const secondStageOpacity = 0.1125;
  const maximumOpacity = 0.50;
  const minimumOccupied = 8;
  const maximumOccupied = SIZE * SIZE * BOARD_DEPTH;

  const progress = Math.min(
    1,
    Math.max(0, (occupiedCount - minimumOccupied) / (maximumOccupied - minimumOccupied))
  );

  if (occupiedCount <= minimumOccupied) return minimumOpacity;

  if (SIZE === 4) {
    const halfwayOccupied = 32;
    const quarterProgress = Math.min(1, progress / 0.25);
    const curveOpacity = minimumOpacity +
      (secondStageOpacity - minimumOpacity) * Math.pow(quarterProgress, 2.5);

    if (occupiedCount < halfwayOccupied) {
      const secondHalfProgress = Math.min(
        1,
        Math.max(0, (occupiedCount - (minimumOccupied + 0.25 * (maximumOccupied - minimumOccupied))) /
          (halfwayOccupied - (minimumOccupied + 0.25 * (maximumOccupied - minimumOccupied))))
      );
      return curveOpacity + (maximumOpacity - curveOpacity) * secondHalfProgress;
    }

    return maximumOpacity;
  }

  const rampStart = 0.25;
  if (progress <= rampStart) return minimumOpacity;

  const rampProgress = (progress - rampStart) / (1 - rampStart);
  return minimumOpacity + (maximumOpacity - minimumOpacity) * Math.pow(rampProgress, 1.75);
}

// Version 1.22.17: blue legal-move surfaces use a synchronized 1-second
// opacity pulse while the user is active. The animation is intentionally
// stopped after 60 seconds of inactivity, or immediately when the browser tab
// becomes hidden. While stopped, the legal surfaces remain at 35%.
const BLUE_OPACITY_MIN = 0.10;
const BLUE_OPACITY_MAX = 0.50;
const BLUE_OPACITY_IDLE = 0.30;
const BLUE_OPACITY_CYCLE_MS = 1000;
const BLUE_OPACITY_TIMEOUT = 60000;
let blueOpacityAnimationActive = false;
let blueOpacityCycleStartTime = performance.now();
let blueOpacityLastActivityTime = performance.now();
let blueOpacityStopTimer = null;

function getBlueOpacity(now = performance.now()) {
  if (!blueOpacityAnimationActive) return BLUE_OPACITY_IDLE;
  const phase = ((now - blueOpacityCycleStartTime) % BLUE_OPACITY_CYCLE_MS) / BLUE_OPACITY_CYCLE_MS;
  // Version 1.22.17: use a squared ease-in curve so the pulse spends more
  // of its cycle toward the lower-opacity end instead of rising linearly.
  const curvedPhase = phase * phase;
  return BLUE_OPACITY_MIN + (BLUE_OPACITY_MAX - BLUE_OPACITY_MIN) * curvedPhase;
}

function armBlueOpacityStopTimer() {
  if (blueOpacityStopTimer !== null) {
    window.clearTimeout(blueOpacityStopTimer);
    blueOpacityStopTimer = null;
  }
  if (!blueOpacityAnimationActive) return;

  const elapsed = performance.now() - blueOpacityLastActivityTime;
  const remaining = Math.max(0, BLUE_OPACITY_TIMEOUT - elapsed);
  blueOpacityStopTimer = window.setTimeout(() => {
    blueOpacityStopTimer = null;
    const inactiveFor = performance.now() - blueOpacityLastActivityTime;
    if (blueOpacityAnimationActive && inactiveFor >= BLUE_OPACITY_TIMEOUT) {
      blueOpacityAnimationActive = false;
      if (legalSurface) legalSurface.material.opacity = BLUE_OPACITY_IDLE;
      if (!autoRotateEnabled && !flipAnimationActive) stopContinuousRendering();
      requestRender();
    } else if (blueOpacityAnimationActive) {
      armBlueOpacityStopTimer();
    }
  }, remaining);
}

function startBlueOpacityAnimation() {
  if (!bluePulseToggle.checked || currentLegalKeys.size === 0) return;
  blueOpacityAnimationActive = true;
  blueOpacityCycleStartTime = performance.now();
  blueOpacityLastActivityTime = blueOpacityCycleStartTime;
  armBlueOpacityStopTimer();
  startContinuousRendering();
}

function noteBlueOpacityActivity() {
  if (!bluePulseToggle.checked || !gameInProgress || currentLegalKeys.size === 0) return;

  const now = performance.now();
  blueOpacityLastActivityTime = now;

  if (!blueOpacityAnimationActive) {
    startBlueOpacityAnimation();
  } else {
    armBlueOpacityStopTimer();
  }
}

window.addEventListener('pointerdown', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('pointermove', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('pointerup', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('wheel', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('touchstart', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('touchmove', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('keydown', noteBlueOpacityActivity, { passive: true, capture: true });
window.addEventListener('click', noteBlueOpacityActivity, { passive: true, capture: true });

function updateLegalSurface() {
  if (legalSurface) {
    cubeGroup.remove(legalSurface);
    legalSurface.geometry.dispose();
    legalSurface.material.dispose();
  }

  const geometry = buildSurfaceGeometryForCells(
    currentLegalKeys,
    highlightedLegalKey
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0x1e46c0,
    transparent: true,
    opacity: bluePulseToggle.checked ? getBlueOpacity() : getLegalSurfaceOpacity(),
    side: THREE.DoubleSide,
    // Write depth so only the frontmost legal blue surface contributes to
    // each screen pixel. This prevents apparent opacity changes caused by
    // multiple translucent legal surfaces overlapping at different depths.
    depthWrite: true
  });

  legalSurface = new THREE.Mesh(geometry, material);
  legalSurface.visible = blueCubesToggle.checked;
  legalSurface.renderOrder = 1;
  cubeGroup.add(legalSurface);
  updateLegalHighlightSurface();
}

function updateLegalCells() {
  const moves = legalMoves(currentPlayer);
  currentLegalKeys = new Set(moves.map(([x, y, z]) => key(x, y, z)));

  if (currentLegalKeys.size === 0) {
    blueOpacityAnimationActive = false;
    if (blueOpacityStopTimer !== null) {
      window.clearTimeout(blueOpacityStopTimer);
      blueOpacityStopTimer = null;
    }
  } else if (bluePulseToggle.checked && !blueOpacityAnimationActive && gameInProgress) {
    startBlueOpacityAnimation();
  }

  if (highlightedLegalKey && !currentLegalKeys.has(highlightedLegalKey)) {
    highlightedLegalKey = null;
  }

  for (const [cellKey, mesh] of cellMeshes.entries()) {
    const [x, y, z] = cellKey.split(',').map(Number);

    // Every cell remains an invisible ray-casting target. Empty cells do not
    // block the pointer ray, while occupied cells do. This lets legal moves
    // inside the larger 6×6×6 and 8×8×8 boards remain selectable without
    // allowing selection through an occupied piece.
    mesh.visible = true;
    mesh.material.opacity = 0;
    mesh.material.color.setHex(
      currentLegalKeys.has(cellKey) ? 0x2f80ed : 0x8f9aa1
    );
    mesh.scale.setScalar(1);
  }

  updateLegalSurface();
  requestRender();

}

function configuredClockDurationMs() {
  if (gameDuration === 'unlimited') return null;
  return Number(gameDuration) * 60 * 1000;
}

function formatClock(ms) {
  const safeMs = Math.max(0, Math.ceil(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getClockRemaining(player, now = performance.now()) {
  const base = clockRemainingMs[player === BLACK ? 'BLACK' : 'WHITE'];
  if (!clockRunning || player !== currentPlayer || clockTurnStartedAt === null) {
    return base;
  }
  return base - Math.max(0, now - clockTurnStartedAt);
}

function updateClockDisplay(now = performance.now()) {
  const durationMs = configuredClockDurationMs();
  const blackScoreText = String(blackScore);
  const whiteScoreText = String(whiteScore);

  if (durationMs === null) {
    blackClockLabel.textContent = `${blackScoreText} Black`;
    whiteClockLabel.textContent = `${whiteScoreText} White`;
    return;
  }

  const black = getClockRemaining(BLACK, now);
  const white = getClockRemaining(WHITE, now);
  blackClockLabel.textContent = `${blackScoreText} Black ${formatClock(black)}`;
  whiteClockLabel.textContent = `${whiteScoreText} White ${formatClock(white)}`;
}

function setClockPanelVisible(visible) {
  clockPanel.classList.toggle('clock-hidden', !visible);
}

function startGameClockTicker() {
  if (gameClockTicker !== null) return;
  gameClockTicker = window.setInterval(() => {
    checkGameClock();
  }, 100);
}

function stopGameClockTicker() {
  if (gameClockTicker === null) return;
  window.clearInterval(gameClockTicker);
  gameClockTicker = null;
}

function initializeGameClock() {
  const durationMs = configuredClockDurationMs();
  if (durationMs === null) {
    stopGameClockTicker();
    clockRemainingMs = { BLACK: 0, WHITE: 0 };
    clockTurnStartedAt = null;
    clockRunning = false;
    timeoutHandled = false;
    updateClockDisplay();
    return;
  }

  clockRemainingMs = { BLACK: durationMs, WHITE: durationMs };
  clockTurnStartedAt = performance.now();
  clockRunning = true;
  timeoutHandled = false;
  updateClockDisplay(clockTurnStartedAt);
  startGameClockTicker();
}

function commitActiveClock(now = performance.now()) {
  if (!clockRunning || clockTurnStartedAt === null || configuredClockDurationMs() === null) {
    return;
  }

  const playerKey = currentPlayer === BLACK ? 'BLACK' : 'WHITE';
  clockRemainingMs[playerKey] = Math.max(
    0,
    clockRemainingMs[playerKey] - Math.max(0, now - clockTurnStartedAt)
  );
  clockTurnStartedAt = now;
}

function switchClockToCurrentPlayer(now = performance.now()) {
  if (configuredClockDurationMs() === null || !clockRunning) return;
  clockTurnStartedAt = now;
}

function stopGameClock(now = performance.now()) {
  commitActiveClock(now);
  clockRunning = false;
  clockTurnStartedAt = null;
  stopGameClockTicker();
  updateClockDisplay(now);
}

function handleTimeout() {
  if (timeoutHandled || configuredClockDurationMs() === null || !clockRunning) return;

  const now = performance.now();
  const playerKey = currentPlayer === BLACK ? 'BLACK' : 'WHITE';
  clockRemainingMs[playerKey] = 0;
  timeoutHandled = true;
  clockRunning = false;
  clockTurnStartedAt = null;
  stopGameClockTicker();
  updateClockDisplay(now);

  const timedOutPlayer = currentPlayer;
  const winner = opponent(timedOutPlayer);
  const timedOutName = timedOutPlayer === BLACK ? 'Black' : 'White';
  const winnerName = winner === BLACK ? 'Black' : 'White';
  const totalPositions = SIZE * SIZE * BOARD_DEPTH;
  const score = winner === BLACK ? `${totalPositions}-0` : `0-${totalPositions}`;

  moveSequenceHistory.push(timedOutPlayer === BLACK ? 'TIMEOUT-BLACK' : 'TIMEOUT-WHITE');
  updateMoveSequenceDisplay();
  gameCompleteActive = true;
  gameInProgress = false;
  passMessage.textContent = `Game Complete\n${timedOutName} ran out of time\n${winnerName} wins\nScore ${score}`;
  passOverlay.classList.add('visible');
  updateLegalCells();
  updateStatus();
  updateUndoButton();
  updateRedoButton();
}

function checkGameClock(now = performance.now()) {
  if (!clockRunning || configuredClockDurationMs() === null || gameCompleteActive) {
    updateClockDisplay(now);
    return;
  }

  if (getClockRemaining(currentPlayer, now) <= 0) {
    handleTimeout();
    return;
  }

  updateClockDisplay(now);
}

function updateStatus() {
  let black = 0;
  let white = 0;
  let empty = 0;

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        if (board[x][y][z] === BLACK) black++;
        if (board[x][y][z] === WHITE) white++;
        if (board[x][y][z] === EMPTY) empty++;
      }
    }
  }

  blackScore = black;
  whiteScore = white;

  playingAsLabel.textContent = opponentMode === 'human'
    ? 'Playing As: Black & White'
    : `Playing As: ${humanPlayer === BLACK ? 'Black' : 'White'}`;

  if (gameCompleteActive) {
    // A completed game has no next player and therefore no meaningful legal
    // move count. Keep the header truthful instead of displaying a stale
    // player turn with 0 Available moves.
    turnText.textContent = 'Game Complete';
    turnMoveCount.textContent = '';
  } else {
    turnText.textContent = currentPlayer === BLACK ? "Black's turn" : "White's turn";
    const currentLegalMoveCount = legalMoves(currentPlayer).length;
    turnMoveCount.textContent = `${currentLegalMoveCount} Available moves`;
  }

  scoreLabel.textContent = `Black ${black} · White ${white}`;
  emptySpacesLabel.textContent = `Spaces Remaining: ${empty}`;
  botDifficultyLabel.textContent = opponentMode === 'bot' ? `Bot: ${botDifficulty.charAt(0).toUpperCase()}${botDifficulty.slice(1)}` : '';
  botDifficultyLabel.hidden = opponentMode !== 'bot';
  updateResignButton();
  updateClockDisplay();
  updateBotDeveloperPanel();
}

function parseCoordinateNotation(value) {
  const compact = value.toUpperCase().replace(/\s+/g, '');
  const xLetters = xLabelLetters.slice(0, SIZE);

  // Version 1.25.10: Classic 8×8×1 uses the standard two-part A-H / 1-8
  // coordinate notation. Internally it still uses z=0 so the authoritative
  // 3D board representation and move rules do not need a separate pathway.
  if (BOARD_DEPTH === 1) {
    const match = compact.match(new RegExp(`^([${xLetters}])-(\\d+)$`));
    if (!match) return null;

    const x = xLetters.indexOf(match[1]);
    const y = Number(match[2]) - 1;
    if (x < 0 || y < 0 || y >= SIZE) return null;
    return [x, y, 0];
  }

  const zLetters = zLabelLetters.slice(0, BOARD_DEPTH);
  const match = compact.match(new RegExp(`^([${xLetters}])-(\\d+)-([${zLetters}])$`));
  if (!match) return null;

  const x = xLetters.indexOf(match[1]);
  const y = Number(match[2]) - 1;
  const z = zLetters.indexOf(match[3]);
  if (x < 0 || y < 0 || y >= SIZE || z < 0) return null;
  return [x, y, z];
}



// -----------------------------------------------------------------------------
// Classic Opening Recognition — Version 1.28.23
// -----------------------------------------------------------------------------
// This catalog is display-only. It does not change Bot move selection. It
// recognizes established named openings and named continuations from the
// current move sequence, including all eight board symmetries.
const CLASSIC_OPENING_RECOGNITION_LINES = [
  { opening: 'Perpendicular', moves: 'F5 D6' },
  { opening: 'Tiger', moves: 'F5 D6 C3 D3 C4' },
  { opening: 'Tiger', variation: 'Aubrey / Tanaka', moves: 'F5 D6 C3 D3 C4 F4 C5 B3' },
  { opening: 'Tiger', variation: 'Rose-Bill', moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2' },
  { opening: 'Tiger', variation: 'Tamenori', moves: 'F5 D6 C3 D3 C4 F4 C5 B3 C2 E6' },
  { opening: 'Tiger', variation: "Leader's Tiger", moves: 'F5 D6 C3 D3 C4 F4 E6' },
  { opening: 'Tiger', variation: 'Stephenson', moves: 'F5 D6 C3 D3 C4 F4 F6' },
  { opening: 'Horse', moves: 'F5 D6 C5 F4 D3' },
  { opening: 'Rose', moves: 'F5 D6 C5 F4 E3 C6 D3 F6 E6 D7' },
  { opening: 'Rose', variation: 'Ralle', moves: 'F5 D6 C5 F4 E3 C6 D3 F3' },
  { opening: 'Rose', variation: 'Inoue', moves: 'F5 D6 C5 F4 E3 C6 E6' },
  { opening: 'Rose', variation: 'Shaman / Danish', moves: 'F5 D6 C5 F4 E3 C6 F3' },
  { opening: 'Rose', variation: 'Bhagat', moves: 'F5 D6 C5 F4 E3 C6 D7' },
  { opening: 'Rose', variation: 'Mimura', moves: 'F5 D6 C5 F4 E3 D3' },
  { opening: 'Buffalo', moves: 'F5 F6 E6 D6 C3' },
  { opening: 'Buffalo', variation: 'Hokuriku Buffalo', moves: 'F5 F6 E6 D6 C3 D3' },
  { opening: 'Buffalo', variation: 'Tanida Buffalo', moves: 'F5 F6 E6 D6 C3 F4 C6 D3 E3 D2' },
  { opening: 'Buffalo', variation: 'Maruoka Buffalo', moves: 'F5 F6 E6 D6 C3 G4 C6' },
  { opening: 'Buffalo', variation: 'Kenichi Variation', moves: 'F5 F6 E6 D6 C3' },
  { opening: 'Heath', moves: 'F5 F6 E6 D6 E7' },
  { opening: 'Heath', variation: 'Heath-Chimney / Mass-Turning', moves: 'F5 F6 E6 D6 E7 F4' },
  { opening: 'Heath', variation: 'Heath-Bat', moves: 'F5 F6 E6 D6 E7 G5 C5' },
  { opening: 'Heath', variation: 'Iwasaki', moves: 'F5 F6 E6 D6 E7 G5 G4' },
  { opening: 'Heath', variation: 'Mimura II', moves: 'F5 F6 E6 D6 E7 G5 G6 E3 C5 C6 D3 C4 B3' },
  { opening: 'Diagonal', moves: 'F5 F6' },
  { opening: 'Diagonal', variation: 'Semi-Wing', moves: 'F5 F6 C4 F4' },
  { opening: 'Diagonal', variation: 'Wing', moves: 'F5 F6 D3 F4' },
  { opening: 'Cow', moves: 'F5 F6 E6 D6 C5' },
  { opening: 'Chimney', moves: 'F5 F6 E6 D6 C5 F4' },
  { opening: 'Lollipop', moves: 'F5 F6 E6 D6 C7 F4' },
  { opening: 'Raccoon Dog', moves: 'F5 F6 E6 D6 D7' },
  { opening: 'Snake / Peasant', moves: 'F5 F6 E6 D6 F7' },
  { opening: 'X-square', moves: 'F5 F6 E6 D6 G7' },
  { opening: 'Parallel', moves: 'F5 F4' },
  { opening: 'Parallel', variation: 'Mouse', moves: 'F5 F4 E3 D6 F3' }
];

function transformClassicRecognitionCoord(x, y, transform) {
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

function parseClassicRecognitionHistory(history) {
  const moves = history.filter((entry) => /^[A-H]-\d+$/i.test(entry));
  return moves.map((entry) => {
    const match = /^([A-H])-(\d+)$/i.exec(entry.replace(/\s+/g, ''));
    return [match[1].toUpperCase().charCodeAt(0) - 65, Number(match[2]) - 1];
  });
}

function recognitionLineMatches(historyMoves, lineMoves) {
  if (historyMoves.length > lineMoves.length) return false;

  for (let transform = 0; transform < 8; transform++) {
    let matches = true;
    for (let index = 0; index < historyMoves.length; index++) {
      const [hx, hy] = historyMoves[index];
      const [lx, ly] = lineMoves[index];
      const [tx, ty] = transformClassicRecognitionCoord(lx, ly, transform);
      if (hx !== tx || hy !== ty) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function getRecognizedClassicOpening(history) {
  if (BOARD_DEPTH !== 1 || SIZE !== 8) return null;
  // PASS does not end the game; keep the educational opening label through passes.
  // Resignation and timeout remain terminal states and do not need an opening label.
  if (history.some((entry) => /^(RESIGN|TIMEOUT)-/.test(entry))) return null;

  const historyMoves = parseClassicRecognitionHistory(history);
  // The first Black move is completely interchangeable under board symmetry.
  // Do not assign an opening family until White has made the second move.
  if (historyMoves.length < 2) return null;

  // Base openings may be recognized from the deepest named prefix that has
  // actually been reached. This is intentionally different from variations:
  // a base opening such as Rose can be shown once its five-move prefix has
  // been played, even if the player then leaves the catalogued Rose line.
  // Named variations still require their complete defining sequence before
  // they are displayed, preventing premature labels such as Tamenori.
  const candidates = CLASSIC_OPENING_RECOGNITION_LINES.map((line) => {
    const lineMoves = line.moves.split(/\s+/).map((token) => [
      token.charCodeAt(0) - 65,
      Number(token[1]) - 1
    ]);

    if (line.variation) {
      if (lineMoves.length > historyMoves.length) return null;
      if (!recognitionLineMatches(historyMoves.slice(0, lineMoves.length), lineMoves)) return null;
      return { line, matchedDepth: lineMoves.length, exact: true };
    }

    const maxDepth = Math.min(historyMoves.length, lineMoves.length);
    let matchedDepth = 0;
    for (let depth = 2; depth <= maxDepth; depth++) {
      if (!recognitionLineMatches(historyMoves.slice(0, depth), lineMoves.slice(0, depth))) break;
      matchedDepth = depth;
    }

    if (matchedDepth < 2) return null;
    return { line, matchedDepth, exact: historyMoves.length >= lineMoves.length && matchedDepth === lineMoves.length };
  }).filter(Boolean);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const depth = b.matchedDepth - a.matchedDepth;
    if (depth) return depth;

    // Prefer a fully reached line over a still-growing prefix at the same
    // depth, then prefer a named variation when both are equally deep.
    const exact = Number(b.exact) - Number(a.exact);
    if (exact) return exact;
    const variation = Number(Boolean(b.line.variation)) - Number(Boolean(a.line.variation));
    return variation || a.line.opening.localeCompare(b.line.opening);
  });

  return candidates[0].line;
}
function updateBookOpeningLabel() {
  if (!bookOpeningLabel) return;
  if (!bookOpeningsEnabled || BOARD_DEPTH !== 1 || SIZE !== 8) {
    bookOpeningLabel.hidden = true;
    bookOpeningLabel.textContent = '';
    return;
  }

  const recognized = getRecognizedClassicOpening(moveSequenceHistory);
  if (!recognized) {
    bookOpeningLabel.hidden = true;
    bookOpeningLabel.textContent = '';
    return;
  }

  bookOpeningLabel.textContent = recognized.variation
    ? `Opening: ${recognized.opening} - ${recognized.variation}`
    : `Opening: ${recognized.opening}`;
  bookOpeningLabel.hidden = false;
}

function updateMoveSequenceDisplay() {
  moveSequence.value = moveSequenceHistory.join(', ');
  moveSequence.scrollTop = moveSequence.scrollHeight;
  updateBookOpeningLabel();
}

function updateUndoButton() {
  const timedGame = configuredClockDurationMs() !== null;
  const timedTwoHumanGame = opponentMode === 'human' && timedGame;
  if (timedTwoHumanGame) {
    undoButton.disabled = true;
    return;
  }
  undoButton.disabled = undoHistory.length === 0;
}

function updateRedoButton() {
  const timedTwoHumanGame = opponentMode === 'human' && configuredClockDurationMs() !== null;
  if (timedTwoHumanGame) {
    redoButton.disabled = true;
    return;
  }
  redoButton.disabled = redoHistory.length === 0;
}

function updateResignButton() {
  resignButton.disabled = gameCompleteActive;
}

function createGameSnapshot() {
  return {
    board: board.map((layer) => layer.map((row) => row.slice())),
    currentPlayer,
    moveSequenceHistory: moveSequenceHistory.slice(),
    lastMoveMarkerKey,
    passMessageActive,
    passPlayer,
    gameCompleteActive,
    gameInProgress,
    timeoutHandled,
    passMessageText: passMessage.textContent
  };
}

function deriveCurrentPlayerFromHistory(history, fallbackPlayer) {
  if (!history.length) return fallbackPlayer;

  let player = BLACK;
  for (const entry of history) {
    if (entry === 'PASS') {
      player = opponent(player);
      continue;
    }

    if (/^RESIGN-(BLACK|WHITE)$/.test(entry) || /^TIMEOUT-(BLACK|WHITE)$/.test(entry)) {
      continue;
    }

    // Every coordinate entry represents one completed turn.
    if (/^[A-H]-\d+-[S-Z]$/i.test(entry)) {
      player = opponent(player);
    }
  }

  return player;
}

function restoreGameSnapshot(snapshot) {
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        board[x][y][z] = snapshot.board[x][y][z];
      }
    }
  }

  currentPlayer = snapshot.currentPlayer;
  moveSequenceHistory = snapshot.moveSequenceHistory.slice();
  lastMoveMarkerKey = snapshot.lastMoveMarkerKey;
  passMessageActive = snapshot.passMessageActive;
  passPlayer = snapshot.passPlayer ?? null;
  gameCompleteActive = snapshot.gameCompleteActive;

  // Reconcile the restored turn from the authoritative move history. This
  // prevents a stale currentPlayer value from surviving Undo/Redo around a
  // PASS. While a pass message is visible, the passing player is deliberately
  // the displayed/current player; otherwise the sequence determines whose
  // turn follows the recorded events. Completed-game states keep their
  // snapshot currentPlayer because there is no next playable turn.
  if (passMessageActive && passPlayer !== null) {
    currentPlayer = passPlayer;
  } else if (!gameCompleteActive) {
    currentPlayer = deriveCurrentPlayerFromHistory(moveSequenceHistory, currentPlayer);
  }
  gameInProgress = snapshot.gameInProgress ?? !gameCompleteActive;
  timeoutHandled = snapshot.timeoutHandled ?? false;
  passMessage.textContent = snapshot.passMessageText || '';
  passOverlay.classList.toggle('visible', passMessageActive || gameCompleteActive);
  highlightedLegalKey = null;
  moveCoordinateInput.value = '';

  updateMoveSequenceDisplay();
  updateLastMoveMarker();
  updatePieces();
  updateOccupiedSurface();
  updateLegalCells();
  updateStatus();
  updateUndoButton();
  updateRedoButton();
  if (clockRunning && configuredClockDurationMs() !== null && !gameCompleteActive) {
    clockTurnStartedAt = performance.now();
  }
}

function undoMove() {
  if (!undoHistory.length) return;

  // Undo always reverses exactly one committed move, regardless of whether
  // the opponent is another human or the bot. In Bot mode this means a bot
  // move can be undone back to the human's immediately preceding move, rather
  // than also undoing the human move.
  if (botMoveTimer !== null) {
    clearTimeout(botMoveTimer);
    botMoveTimer = null;
  }

  // Undo/Redo never rewinds clock time. Commit the currently active clock
  // before changing game state, then let the restored current player continue
  // from the present moment.
  const clockNow = performance.now();
  commitActiveClock(clockNow);

  redoHistory.push(createGameSnapshot());
  const snapshot = undoHistory.pop();
  restoreGameSnapshot(snapshot);

  // Undo/Redo enters history-review mode. The restored position must be
  // displayed exactly as it exists in the game history, without immediately
  // letting the bot advance it again. This is especially important when an
  // undone bot move was followed by a PASS: the position before that move can
  // legitimately be the bot's turn.
  historyReviewActive = true;
  applyHistoryReviewTurn();

  if (clockRunning && configuredClockDurationMs() !== null && !gameCompleteActive) {
    clockTurnStartedAt = clockNow;
  }
}

function applyHistoryReviewTurn() {
  // During Undo/Redo review, trust the currentPlayer stored in the restored
  // snapshot. A snapshot taken immediately before a move after a PASS already
  // represents the player who received the turn after that PASS. Re-deriving
  // the turn solely from moveSequenceHistory would mistake a trailing PASS for
  // a still-pending pass and repeatedly show the passing player instead.
  //
  // Normal gameplay PASS handling is unchanged. This helper only removes the
  // transient PASS UI while keeping the restored historical turn intact.
  passMessageActive = false;
  passPlayer = null;
  passMessage.textContent = '';
  passOverlay.classList.remove('visible');
  updateLegalCells();
  updateStatus();
}

function redoMove() {
  if (!redoHistory.length) return;

  if (botMoveTimer !== null) {
    clearTimeout(botMoveTimer);
    botMoveTimer = null;
  }

  // Redo always restores exactly one committed move. In Bot mode this lets
  // the user move forward through the human and bot moves one at a time.
  // Clock time is deliberately not part of the undo/redo operation.
  const clockNow = performance.now();
  commitActiveClock(clockNow);

  undoHistory.push(createGameSnapshot());
  const snapshot = redoHistory.pop();
  restoreGameSnapshot(snapshot);

  // Reassert terminal state when Redo reaches a completed board. The loaded
  // sequence's final snapshot is authoritative, but this explicit terminal
  // check protects the completed-game state from being lost during history
  // review transitions.
  const occupiedAfterRedo = board.flat(2).filter((value) => value !== EMPTY).length;
  if (occupiedAfterRedo === SIZE * SIZE * BOARD_DEPTH ||
      (legalMoves(BLACK).length === 0 && legalMoves(WHITE).length === 0)) {
    gameCompleteActive = true;
    passMessageActive = false;
    passPlayer = null;

    // Redo is history review, not a new game-ending event. A terminal
    // snapshot can legitimately contain no completion text because the
    // original message was already dismissed. Do not resurrect the modal
    // overlay here (which previously produced a blank message bubble).
    // Keep gameCompleteActive true so the header still reports Game Complete.
    passMessage.textContent = '';
    passOverlay.classList.remove('visible');
  }

  // Stay in review mode while there are still positions ahead in Redo. When
  // Redo reaches the latest game state, return to normal play and resume the
  // bot only if the latest state genuinely belongs to the bot.
  historyReviewActive = redoHistory.length > 0;
  if (historyReviewActive) {
    applyHistoryReviewTurn();
  } else {
    updateLegalCells();
    updateStatus();
  }
  if (!historyReviewActive && opponentMode === 'bot' && !gameCompleteActive && !passMessageActive) {
    scheduleBotTurn();
  }

  if (clockRunning && configuredClockDurationMs() !== null && !gameCompleteActive) {
    clockTurnStartedAt = clockNow;
  }
}

function showHelp() {
  helpOverlay.classList.add('visible');
  helpOverlay.setAttribute('aria-hidden', 'false');
}

function hideHelp() {
  helpOverlay.classList.remove('visible');
  helpOverlay.setAttribute('aria-hidden', 'true');
}

function showMoveSequence() {
  updateMoveSequenceDisplay();
  sequenceOverlay.classList.add('visible');
  sequenceOverlay.setAttribute('aria-hidden', 'false');
  moveSequence.focus();
  moveSequence.select();
}

function hideMoveSequence() {
  sequenceOverlay.classList.remove('visible');
  sequenceOverlay.setAttribute('aria-hidden', 'true');
}

let loadSequenceOpenedFromStart = false;

function showLoadSequencePanel(fromStartScreen = false) {
  hideMoveSequence();
  loadSequenceOpenedFromStart = fromStartScreen;
  if (fromStartScreen) {
    hideStartScreen();
  }
  // Version 1.28.7: every opening starts with an empty sequence field so a
  // previous test sequence cannot remain in the loader.
  loadSequenceInput.value = '';
  loadSequenceError.textContent = '';
  loadSequenceOverlay.classList.add('visible');
  loadSequenceOverlay.setAttribute('aria-hidden', 'false');
  loadSequenceInput.focus();
}

function showLoadSequence() {
  if (hasGameInProgress()) {
    showGameEndConfirmation(
      'Loading a move sequence will end the current game.',
      showLoadSequencePanel
    );
    return;
  }
  showLoadSequencePanel();
}

function showLoadSequenceFromStartScreen() {
  showLoadSequencePanel(true);
}

function hideLoadSequence() {
  const returnToStartScreen = loadSequenceOpenedFromStart;
  loadSequenceOpenedFromStart = false;
  loadSequenceOverlay.classList.remove('visible');
  loadSequenceOverlay.setAttribute('aria-hidden', 'true');
  loadSequenceError.textContent = '';
  if (returnToStartScreen) {
    showStartScreen();
  }
}

function sequenceUsesClassicTwoPartCoordinates(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const tokens = trimmed.split(',').map((token) => token.trim().toUpperCase());
  const coordinateTokens = tokens.filter((token) => {
    return token !== 'PASS' &&
      !/^RESIGN-(BLACK|WHITE)$/.test(token) &&
      !/^TIMEOUT-(BLACK|WHITE)$/.test(token);
  });

  // A sequence containing only standard two-part A-H / 1-8 coordinates is
  // unambiguously a Classic 8×8×1 sequence. This is especially important when
  // Load Sequence is opened directly from the Start Menu, because the active
  // board is otherwise still the default 4×4×4 board at that point.
  if (!coordinateTokens.length) return false;
  return coordinateTokens.every((token) => /^[A-H]-\d+$/i.test(token));
}

function parseMoveSequenceText(text) {
  const trimmed = text.trim();
  if (!trimmed) return { tokens: [], error: 'Enter a move sequence.' };

  const tokens = trimmed.split(',').map((token) => token.trim().toUpperCase());
  if (tokens.some((token) => token === '')) {
    return { tokens: [], error: 'The sequence contains an empty entry.' };
  }

  for (const token of tokens) {
    if (token === 'PASS' || /^RESIGN-(BLACK|WHITE)$/.test(token) || /^TIMEOUT-(BLACK|WHITE)$/.test(token)) continue;
    const compact = token.replace(/\s+/g, '');
    if (!parseCoordinateNotation(compact)) {
      return { tokens: [], error: `Invalid sequence entry: ${token}` };
    }
  }

  return {
    tokens: tokens.map((token) => {
      if (token === 'PASS' || /^RESIGN-(BLACK|WHITE)$/.test(token) || /^TIMEOUT-(BLACK|WHITE)$/.test(token)) return token;
      return token.replace(/\s+/g, '');
    }),
    error: ''
  };
}

function resetBoardForSequenceLoad() {
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        board[x][y][z] = EMPTY;
      }
    }
  }
  makeInitialPosition();
  currentPlayer = BLACK;
  passMessageActive = false;
  passPlayer = null;
  gameCompleteActive = false;
  gameInProgress = true;
  passMessage.textContent = '';
  passOverlay.classList.remove('visible');
  moveSequenceHistory = [];
  updateBookOpeningLabel();
  undoHistory = [];
  redoHistory = [];
  historyReviewActive = false;
  lastMoveMarkerKey = null;
  highlightedLegalKey = null;
}

function loadMoveSequence() {
  // Version 1.28.3: a two-part X-Y move sequence is the application's Classic
  // 8×8×1 notation. Select that board before parsing so sequences loaded from
  // the Start Menu (or from a previously completed 3D game) are interpreted
  // correctly instead of being rejected as missing a Z coordinate.
  if (sequenceUsesClassicTwoPartCoordinates(loadSequenceInput.value)) {
    if (SIZE !== 8 || BOARD_DEPTH !== 1) rebuildBoardForSize('8x8x1');
  }

  const parsed = parseMoveSequenceText(loadSequenceInput.value);
  if (parsed.error) {
    loadSequenceError.textContent = parsed.error;
    return;
  }

  const originalSnapshot = createGameSnapshot();
  const originalUndoHistory = undoHistory.slice();
  const originalRedoHistory = redoHistory.slice();
  resetBoardForSequenceLoad();
  let passRequired = false;

  const rejectLoadedSequence = (message) => {
    restoreGameSnapshot(originalSnapshot);
    undoHistory = originalUndoHistory;
    redoHistory = originalRedoHistory;
    updateUndoButton();
    updateRedoButton();
    loadSequenceError.textContent = message;
  };

  for (let index = 0; index < parsed.tokens.length; index++) {
    const token = parsed.tokens[index];

    if (token === 'PASS') {
      const currentMoves = legalMoves(currentPlayer);
      const nextMoves = legalMoves(opponent(currentPlayer));
      if (!passRequired || currentMoves.length !== 0 || nextMoves.length === 0) {
        rejectLoadedSequence(`Invalid PASS at entry ${index + 1}.`);
        return;
      }
      // A loaded PASS is a real historical turn even though it does not
      // change the board. Save the pre-PASS position so Undo/Redo can stop on
      // the passing player's turn (0 legal moves) instead of skipping directly
      // from one move by the receiving player to the next receiving-player
      // position. This makes PASS positions first-class history-review steps.
      undoHistory.push(createGameSnapshot());
      redoHistory = [];
      moveSequenceHistory.push('PASS');
      // A loaded PASS is a completed turn. Advance to the player who receives
      // control after the pass so the loaded position can continue normally.
      currentPlayer = opponent(currentPlayer);
      passRequired = false;
      continue;
    }

    if (/^RESIGN-(BLACK|WHITE)$/.test(token)) {
      if (gameCompleteActive || passRequired) {
        rejectLoadedSequence(`Invalid resignation at entry ${index + 1}.`);
        return;
      }
      const resignedPlayer = token === 'RESIGN-BLACK' ? BLACK : WHITE;
      if (resignedPlayer !== currentPlayer) {
        rejectLoadedSequence(`Invalid resignation at entry ${index + 1}: ${token} does not match the player whose turn it is.`);
        return;
      }
      moveSequenceHistory.push(token);
      showResignationMessage(resignedPlayer);
      passRequired = false;
      continue;
    }

    if (/^TIMEOUT-(BLACK|WHITE)$/.test(token)) {
      if (gameCompleteActive || passRequired) {
        rejectLoadedSequence(`Invalid timeout at entry ${index + 1}.`);
        return;
      }
      const timedOutPlayer = token === 'TIMEOUT-BLACK' ? BLACK : WHITE;
      if (timedOutPlayer !== currentPlayer) {
        rejectLoadedSequence(`Invalid timeout at entry ${index + 1}: ${token} does not match the player whose turn it is.`);
        return;
      }
      moveSequenceHistory.push(token);
      handleLoadedTimeoutMessage(timedOutPlayer);
      passRequired = false;
      continue;
    }

    if (gameCompleteActive) {
      rejectLoadedSequence(`The sequence continues after Game Complete at entry ${index + 1}.`);
      return;
    }

    if (passRequired) {
      rejectLoadedSequence(`A PASS is required before entry ${index + 1}.`);
      return;
    }

    const coordinates = parseCoordinateNotation(token);
    if (!coordinates) {
      rejectLoadedSequence(`Invalid coordinate at entry ${index + 1}.`);
      return;
    }

    const [x, y, z] = coordinates;
    if (!isLegalMove(x, y, z, currentPlayer)) {
      rejectLoadedSequence(`Illegal move at entry ${index + 1}: ${token}.`);
      return;
    }

    undoHistory.push(createGameSnapshot());
    redoHistory = [];
    const flips = getFlips(x, y, z, currentPlayer);
    board[x][y][z] = currentPlayer;
    for (const [fx, fy, fz] of flips) {
      board[fx][fy][fz] = currentPlayer;
    }
    moveSequenceHistory.push(token);
    lastMoveMarkerKey = key(x, y, z);

    const occupiedCount = board.flat(2).filter((value) => value !== EMPTY).length;
    if (occupiedCount === SIZE * SIZE * BOARD_DEPTH) {
      lastMoveMarkerKey = null;
      gameCompleteActive = true;
      continue;
    }

    const nextPlayer = opponent(currentPlayer);
    const nextMoves = legalMoves(nextPlayer);
    if (nextMoves.length) {
      currentPlayer = nextPlayer;
      passRequired = false;
    } else {
      const currentMoves = legalMoves(currentPlayer);
      if (currentMoves.length) {
        // The opponent is the player who must pass. Make that player the
        // currentPlayer before validating the recorded PASS token. This keeps
        // the loaded-sequence state identical to normal gameplay, where the
        // player who has no legal move is the visible passing player.
        currentPlayer = nextPlayer;
        passRequired = true;
      } else {
        gameCompleteActive = true;
        passRequired = false;
      }
    }
  }

  if (!gameCompleteActive && legalMoves(currentPlayer).length === 0) {
    if (legalMoves(opponent(currentPlayer)).length > 0) {
      rejectLoadedSequence('The sequence ends before the required PASS.');
      return;
    }
    gameCompleteActive = true;
  }

  gameInProgress = !gameCompleteActive;
  updateMoveSequenceDisplay();
  updateUndoButton();
  updateRedoButton();
  updateLastMoveMarker();
  updatePieces();
  updateOccupiedSurface();
  updateLegalCells();
  updateStatus();
  // Do not start a loaded game's clock or bot turn until the user has chosen
  // how to play the loaded position. The loaded sequence itself contains
  // moves, but it does not identify which color the user wants to control.
  stopGameClock();
  gameDuration = 'unlimited';
  setClockPanelVisible(true);
  if (configuredClockDurationMs() !== null && undoHistory.length > 1) {
    undoHistory = undoHistory.slice(-1);
  }
  updateUndoButton();
  moveCoordinateInput.value = '';
  loadSequenceOpenedFromStart = false;
  hideLoadSequence();

  // Always ask how the user wants to play a loaded sequence, including when
  // the loaded position is already Game Complete. The choice is still needed
  // for Undo/Redo review so the loaded game retains the intended interaction
  // mode instead of silently becoming a Two Player game.
  showLoadedSequenceChoice();
}

function updateLoadedSequenceDifficultyVisibility() {
  const selectedMode = document.querySelector('input[name="loadedPlayerMode"]:checked')?.value || 'both';
  const botMode = selectedMode !== 'both';
  loadedBotDifficultyFieldset.classList.toggle('start-hidden', !botMode);
  loadedBotDifficultyFieldset.hidden = !botMode;
}

function showLoadedSequenceChoice() {
  const defaultChoice = document.querySelector('input[name="loadedPlayerMode"][value="both"]');
  if (defaultChoice) defaultChoice.checked = true;
  const defaultDifficulty = document.querySelector(`input[name="loadedBotDifficulty"][value="${botDifficulty}"]`);
  if (defaultDifficulty) defaultDifficulty.checked = true;
  updateLoadedSequenceDifficultyVisibility();
  loadedSequenceChoiceOverlay.classList.add('visible');
  loadedSequenceChoiceOverlay.setAttribute('aria-hidden', 'false');
  loadedSequenceChoiceContinue.focus();
}

function hideLoadedSequenceChoice() {
  loadedSequenceChoiceOverlay.classList.remove('visible');
  loadedSequenceChoiceOverlay.setAttribute('aria-hidden', 'true');
}

function continueLoadedSequence() {
  const selectedMode = document.querySelector('input[name="loadedPlayerMode"]:checked')?.value || 'both';

  if (selectedMode === 'black') {
    opponentMode = 'bot';
    humanPlayer = BLACK;
  } else if (selectedMode === 'white') {
    opponentMode = 'bot';
    humanPlayer = WHITE;
  } else {
    opponentMode = 'human';
    humanPlayer = BLACK;
  }

  if (selectedMode !== 'both') {
    botDifficulty = document.querySelector('input[name="loadedBotDifficulty"]:checked')?.value || botDifficulty;
  }

  hideLoadedSequenceChoice();
  resetBotDeveloperSummary();

  // Loaded sequences never use the game clock. The sequence does not carry
  // reliable timing information, so leave the clock removed for the loaded
  // position regardless of the settings used by the previous game.
  gameDuration = 'unlimited';
  stopGameClock();
  setClockPanelVisible(true);

  updateUndoButton();
  updateRedoButton();
  updateLegalCells();
  updateStatus();
  scheduleBotTurn();
}

async function copyMoveSequence() {
  const text = moveSequenceHistory.join(', ');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    moveSequence.focus();
    moveSequence.select();
    document.execCommand('copy');
  }
}

function submitCoordinateMove() {
  if (gameCompleteActive) return;

  const value = moveCoordinateInput.value;

  if (!parseCoordinateNotation(value)) {
    return;
  }

  const coordinates = parseCoordinateNotation(value);
  if (!coordinates) return;

  const [x, y, z] = coordinates;
  const notation = coordinateNotation(x, y, z);

  if (!isLegalMove(x, y, z, currentPlayer)) {
    passMessage.textContent = 'Unavailable Move';
    passMessageActive = true;
    passOverlay.classList.add('visible');
    return;
  }

  // Clear the transient hover state BEFORE changing the game state.
  // The typed move then follows the same authoritative path as a clicked move.
  moveCoordinateInput.value = '';
  highlightedLegalKey = null;
  playMove(x, y, z);
}

function handleCoordinateInputKey(event) {
  const value = moveCoordinateInput.value;
  const length = value.length;

  if (event.key === 'Backspace') {
    event.preventDefault();

    // If the browser has selected the entire coordinate (for example after
    // tabbing into the field), Backspace should clear the field normally.
    const selectionStart = moveCoordinateInput.selectionStart ?? 0;
    const selectionEnd = moveCoordinateInput.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) {
      moveCoordinateInput.value = '';
      return;
    }

    if (length === 0) return;

    // Remove one coordinate component at a time and keep the automatic
    // separators intact. This prevents the user from getting stuck after
    // deleting a hyphen that the input system normally inserts itself.
    if (length === 1 || length === 2) {
      moveCoordinateInput.value = '';
    } else if (BOARD_DEPTH === 1) {
      moveCoordinateInput.value = value.slice(0, 2);
    } else if (length === 3 || length === 4) {
      moveCoordinateInput.value = value.slice(0, 2);
    } else {
      moveCoordinateInput.value = value.slice(0, 4);
    }
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();

    if ((BOARD_DEPTH === 1 && length === 3) || (BOARD_DEPTH !== 1 && length === 5)) {
      submitCoordinateMove();
    }

    return;
  }

  let accepted = null;

  const xLetters = xLabelLetters.slice(0, SIZE);
  const zLetters = zLabelLetters.slice(0, BOARD_DEPTH);
  if (length === 0 && new RegExp(`^[${xLetters.toLowerCase()}]$`, 'i').test(event.key)) {
    accepted = event.key.toUpperCase() + '-';
  } else if (length === 2 && /^[1-8]$/.test(event.key) && Number(event.key) <= SIZE) {
    accepted = BOARD_DEPTH === 1
      ? value + event.key
      : value + event.key + '-';
  } else if (BOARD_DEPTH !== 1 && length === 4 && new RegExp(`^[${zLetters}]$`, 'i').test(event.key)) {
    accepted = value + event.key.toUpperCase();
  }

  // Every key other than the currently valid coordinate character or
  // backspace/enter is ignored while the coordinate is being entered.
  event.preventDefault();

  if (accepted !== null) {
    moveCoordinateInput.value = accepted;
  }
}

function showPassMessage(player) {
  passPlayer = player;
  currentPlayer = player;
  passMessage.textContent = player === BLACK ? 'Black passes' : 'White passes';
  passMessageActive = true;
  passOverlay.classList.add('visible');
  updateLegalCells();
  updateStatus();
}

function dismissPassMessage() {
  // Track the actual passing player explicitly. This prevents a pass from
  // being advanced from a stale/changed currentPlayer value, which previously
  // could hand the bot the human's turn or leave the wrong color active.
  const wasGameComplete = gameCompleteActive;
  // Only a genuine PASS has a passPlayer. An unavailable coordinate-entry
  // warning also uses this overlay, but must never advance the turn.
  if (passMessageActive && !gameCompleteActive && passPlayer !== null) {
    currentPlayer = opponent(passPlayer);
  }
  passPlayer = null;
  passMessageActive = false;
  if (!wasGameComplete) {
    gameCompleteActive = false;
  }
  passMessage.textContent = '';
  passOverlay.classList.remove('visible');
  updateLegalCells();
  updateStatus();

  // Once a game has completed, dismissing the completion message should
  // leave the finished position available for analysis. In Bot Mode,
  // scheduling the bot here would immediately see that neither side can
  // move and would show Game Complete again. Two-human mode already leaves
  // the position alone, so Bot Mode must do the same after completion.
  if (!wasGameComplete) {
    scheduleBotTurn();
  }
}

function handleLoadedTimeoutMessage(timedOutPlayer) {
  const winner = opponent(timedOutPlayer);
  const timedOutName = timedOutPlayer === BLACK ? 'Black' : 'White';
  const winnerName = winner === BLACK ? 'Black' : 'White';
  const totalPositions = SIZE * SIZE * BOARD_DEPTH;
  const score = winner === BLACK ? `${totalPositions}-0` : `0-${totalPositions}`;

  gameCompleteActive = true;
  passMessage.textContent = `Game Complete\n${timedOutName} ran out of time\n${winnerName} wins\nScore ${score}`;
  passOverlay.classList.add('visible');
  stopGameClock();
}

function showResignationMessage(resignedPlayer) {
  const winner = opponent(resignedPlayer);
  const resignedName = resignedPlayer === BLACK ? 'Black' : 'White';
  const winnerName = winner === BLACK ? 'Black' : 'White';
  const totalPositions = SIZE * SIZE * BOARD_DEPTH;
  const score = winner === BLACK ? `${totalPositions}-0` : `0-${totalPositions}`;

  passMessage.textContent = `Game Complete\n${resignedName} resigned\n${winnerName} wins\nScore ${score}`;
  gameCompleteActive = true;
  gameInProgress = false;
  passOverlay.classList.add('visible');
  stopGameClock();
}

function revealGreenCubesOnCompletion() {
  // When a game reaches a normal terminal position, reveal the occupied
  // green-cell surfaces for the final board view. This changes the toggle
  // state normally; it does not lock the option, so the user can turn Green
  // Cubes back off afterward.
  if (!hideGreenCubesToggle.checked) {
    hideGreenCubesToggle.checked = true;
    if (occupiedSurface) occupiedSurface.visible = true;
    requestRender();
  }
}

function showGameComplete() {
  revealGreenCubesOnCompletion();

  let black = 0;
  let white = 0;

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        if (board[x][y][z] === BLACK) black++;
        if (board[x][y][z] === WHITE) white++;
      }
    }
  }

  let result;
  if (black > white) {
    result = `Black wins\nBlack ${black} · White ${white}`;
  } else if (white > black) {
    result = `White wins\nBlack ${black} · White ${white}`;
  } else {
    result = `Draw\nBlack ${black} · White ${white}`;
  }

  passMessage.textContent = `Game Complete\n${result}`;
  gameCompleteActive = true;
  gameInProgress = false;
  passOverlay.classList.add('visible');
  stopGameClock();
}

function playMove(x, y, z, isBotMove = false) {
  if (passMessageActive || gameCompleteActive) return;
  if (opponentMode === 'bot' && currentPlayer !== humanPlayer && !isBotMove) return;
  if (!isLegalMove(x, y, z, currentPlayer)) return;

  historyReviewActive = false;
  const moveClockTime = performance.now();
  commitActiveClock(moveClockTime);

  const flips = getFlips(x, y, z, currentPlayer);
  undoHistory.push(createGameSnapshot());
  redoHistory = [];
  moveSequenceHistory.push(coordinateNotation(x, y, z).replace(/\s+/g, ''));
  updateMoveSequenceDisplay();
  updateUndoButton();
  updateRedoButton();
  board[x][y][z] = currentPlayer;

  for (const [fx, fy, fz] of flips) {
    board[fx][fy][fz] = currentPlayer;
  }

  let occupiedCount = 0;
  for (let ix = 0; ix < SIZE; ix++) {
    for (let iy = 0; iy < SIZE; iy++) {
      for (let iz = 0; iz < BOARD_DEPTH; iz++) {
        if (board[ix][iy][iz] !== EMPTY) occupiedCount++;
      }
    }
  }

  lastMoveMarkerKey = occupiedCount === SIZE * SIZE * BOARD_DEPTH
    ? null
    : key(x, y, z);
  updateLastMoveMarker();

  updatePieces();
  updateOccupiedSurface();

  const nextPlayer = opponent(currentPlayer);
  const nextMoves = legalMoves(nextPlayer);

  if (nextMoves.length) {
    currentPlayer = nextPlayer;
  } else {
    // The opponent has no legal move. If the current player can still move,
    // the opponent passes. If neither player can move, the game is complete,
    // even when empty positions remain on the board.
    const currentMoves = legalMoves(currentPlayer);
    if (currentMoves.length) {
      moveSequenceHistory.push('PASS');
      updateMoveSequenceDisplay();
      // Always represent the pass explicitly and remember which player passed.
      // In Bot Mode this is intentionally non-ambiguous: the bot's pass is
      // shown with 0 Available moves, and dismissing it advances to the other
      // player. This keeps pass handling identical for human and bot players.
      showPassMessage(nextPlayer);
    } else {
      showGameComplete();
    }
  }

  if (gameCompleteActive) {
    stopGameClock();
  } else {
    switchClockToCurrentPlayer();
  }

  updateLegalCells();
  updateStatus();

  moveCoordinateInput.value = '';
  scheduleBotTurn();
}

let pendingResignationPlayer = null;

function showResignConfirmation() {
  if (passMessageActive || gameCompleteActive || pendingResignationPlayer !== null) return;

  pendingResignationPlayer = currentPlayer;
  resignConfirmOverlay.classList.add('visible');
  resignConfirmOverlay.setAttribute('aria-hidden', 'false');
  confirmResignButton.focus();
}

function hideResignConfirmation() {
  pendingResignationPlayer = null;
  resignConfirmOverlay.classList.remove('visible');
  resignConfirmOverlay.setAttribute('aria-hidden', 'true');
}

function confirmResignation() {
  if (pendingResignationPlayer === null) return;

  const resignedPlayer = pendingResignationPlayer;
  hideResignConfirmation();

  undoHistory.push(createGameSnapshot());
  redoHistory = [];
  moveSequenceHistory.push(resignedPlayer === BLACK ? 'RESIGN-BLACK' : 'RESIGN-WHITE');
  updateMoveSequenceDisplay();
  updateUndoButton();
  updateRedoButton();
  showResignationMessage(resignedPlayer);
  stopGameClock();
  updateLegalCells();
  updateStatus();
}

function resignGame() {
  if (gameCompleteActive) return;
  showResignConfirmation();
}

function updateVersionLabel() {
  const boardSizeText = BOARD_DEPTH === 1 ? `${SIZE}×${SIZE}×1 (Classic)` : `${SIZE}×${SIZE}×${BOARD_DEPTH}`;
  versionLabel.innerHTML = `<span class="version-number">Version 1.28.23</span><span class="version-separator"> · </span><span class="version-board-size">${boardSizeText}</span>`;
  document.title = `Cube Reversi — 1.28.23`;
  moveCoordinateInput.placeholder = BOARD_DEPTH === 1 ? 'A - 2' : 'A - 2 - S';
}

function rebuildBoardForSize(newSize) {
  if (newSize === '8x8x1') {
    SIZE = 8;
    BOARD_DEPTH = 1;
  } else {
    SIZE = Number(newSize);
    BOARD_DEPTH = SIZE;
  }

  boardOffset = (SIZE - 1) / 2;
  boardOffsetZ = (BOARD_DEPTH - 1) / 2;
  board = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => Array(BOARD_DEPTH).fill(EMPTY))
  );

  for (const mesh of cellMeshes.values()) {
    cubeGroup.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  cellMeshes.clear();
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        createCell(x, y, z);
      }
    }
  }

  rebuildWireframe();
  boardHalfExtent = boardOffset * spacing + 0.625;
  mainOrientationMarker.position.set(-boardHalfExtent, -boardHalfExtent, -boardOffsetZ * spacing - 0.625);
  rebuildOrientationEdges();
  rebuildCoordinateGuide();
  updateCoordinateAxisVisibility();
  updateCoordinateGuideHighlight();
  setInitialCameraPosition();
  updateControlDistanceLimits();
  updateVersionLabel();
  requestRender();
}

function resetBoardForNewGame() {
  if (botMoveTimer !== null) { clearTimeout(botMoveTimer); botMoveTimer = null; }
  stopGameClockTicker();
  clockRunning = false;
  clockTurnStartedAt = null;
  timeoutHandled = false;
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      for (let z = 0; z < BOARD_DEPTH; z++) {
        board[x][y][z] = EMPTY;
      }
    }
  }

  currentPlayer = BLACK;
  gameCompleteActive = false;
  gameInProgress = true;

  // Version 1.24.1: Green Cubes and Blue Cubes are per-game display
  // preferences. A completed game may reveal them automatically, but every
  // newly started game must return both options to their default OFF state.
  hideGreenCubesToggle.checked = false;
  if (occupiedSurface) occupiedSurface.visible = false;
  blueCubesToggle.checked = false;
  if (legalSurface) legalSurface.visible = false;

  setClockPanelVisible(true);
  moveSequenceHistory = [];
  undoHistory = [];
  redoHistory = [];
  historyReviewActive = false;
  updateMoveSequenceDisplay();
  updateUndoButton();
  updateRedoButton();
  dismissPassMessage();
  lastMoveMarkerKey = null;
  updateLastMoveMarker();
  makeInitialPosition();
  updatePieces();
  updateOccupiedSurface();
  updateLegalCells();
  updateStatus();
  resetView();
}

function updateStartScreenOptions() {
  const selectedOpponent = document.querySelector('input[name="opponentMode"]:checked')?.value || 'human';
  const colorHidden = selectedOpponent === 'human';
  colorFieldset.classList.toggle('start-hidden', colorHidden);
  colorFieldset.hidden = colorHidden;

  // Timed games are unavailable in Bot Opponent mode. Remove the duration
  // control entirely rather than leaving a disabled selector taking up space.
  const botModeSelected = selectedOpponent === 'bot';
  const difficultyFieldset = document.getElementById('difficultyFieldset');
  if (difficultyFieldset) {
    difficultyFieldset.classList.toggle('start-hidden', !botModeSelected);
    difficultyFieldset.hidden = !botModeSelected;
  }
  gameDurationLabel.classList.toggle('start-hidden', botModeSelected);
  gameDurationSelect.classList.toggle('start-hidden', botModeSelected);
  if (botModeSelected) {
    gameDurationSelect.value = 'unlimited';
    gameDurationNote.textContent = 'Game clock is disabled in Bot Mode';
  } else {
    gameDurationNote.textContent = '';
  }
}

function showStartScreen() {
  if (botMoveTimer !== null) { clearTimeout(botMoveTimer); botMoveTimer = null; }
  stopGameClock();
  setClockPanelVisible(false);
  updateStartScreenOptions();
  startOverlay.classList.add('visible');
  startOverlay.setAttribute('aria-hidden', 'false');
  startGameButton.focus();
}

function hideStartScreen() {
  startOverlay.classList.remove('visible');
  startOverlay.setAttribute('aria-hidden', 'true');
}

// Version 1.21.2 / 1.28.x: keyboard navigation for the start menu. Arrow
// keys move focus through the currently visible start-menu controls. Spacebar
// selects the currently focused radio without advancing to another option.
// Enter always starts the game while the start menu is visible. Outside the
// start menu, Spacebar keeps its established Auto-Rotate function.
function getStartMenuFocusableElements() {
  if (!startOverlay.classList.contains('visible')) return [];

  return Array.from(startPanel.querySelectorAll('input, select, button')).filter((element) => {
    if (element.disabled) return false;
    if (element.closest('.start-hidden')) return false;
    if (element.offsetParent === null) return false;
    return true;
  });
}

function moveStartMenuFocus(direction) {
  const focusables = getStartMenuFocusableElements();
  if (!focusables.length) return;

  const currentIndex = focusables.indexOf(document.activeElement);
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + focusables.length) % focusables.length;

  focusables[nextIndex].focus({ preventScroll: true });
}

// Version 1.28.7: keep keyboard focus inside the Load Sequence dialog's
// intended controls. The textarea is the entry point; Tab advances to Load,
// then Cancel, and wraps back to the textarea. Shift+Tab reverses the cycle.
function getLoadSequenceFocusableElements() {
  if (!loadSequenceOverlay.classList.contains('visible')) return [];

  return [loadSequenceInput, loadSequenceButtonConfirm, cancelLoadSequenceButton]
    .filter((element) => element && !element.disabled && !element.hidden);
}

function moveLoadSequenceFocus(direction) {
  const focusables = getLoadSequenceFocusableElements();
  if (!focusables.length) return;

  const currentIndex = focusables.indexOf(document.activeElement);
  const nextIndex = currentIndex === -1
    ? 0
    : (currentIndex + direction + focusables.length) % focusables.length;

  focusables[nextIndex].focus({ preventScroll: true });
}

function startGameFromSplash() {
  const selectedSize = document.querySelector('input[name="boardSize"]:checked')?.value || '4';
  const selectedDepth = selectedSize === '8x8x1' ? 1 : Number(selectedSize);
  const selectedWidth = 8;
  if (selectedWidth !== SIZE || selectedDepth !== BOARD_DEPTH) rebuildBoardForSize(selectedSize);

  opponentMode = document.querySelector('input[name="opponentMode"]:checked')?.value || 'human';
  const selectedColor = document.querySelector('input[name="playerColor"]:checked')?.value || 'black';
  humanPlayer = selectedColor === 'white'
    ? WHITE
    : selectedColor === 'random'
      ? (Math.random() < 0.5 ? BLACK : WHITE)
      : BLACK;
  gameDuration = gameDurationSelect.value;
  botDifficulty = document.querySelector('input[name="botDifficulty"]:checked')?.value || 'medium';
  developerMode = !!developerModeToggle?.checked;

  gameInProgress = true;
  resetBotDeveloperSummary();
  resetBoardForNewGame();
  initializeGameClock();
  hideStartScreen();
  scheduleBotTurn();
}

function hasGameInProgress() {
  return gameInProgress && !gameCompleteActive;
}

function showGameEndConfirmation(message, action) {
  if (pendingGameEndAction !== null) return;
  pendingGameEndAction = action;
  gameEndConfirmMessage.textContent = message;
  gameEndConfirmOverlay.classList.add('visible');
  gameEndConfirmOverlay.setAttribute('aria-hidden', 'false');
  confirmGameEndButton.focus();
}

function hideGameEndConfirmation() {
  pendingGameEndAction = null;
  gameEndConfirmOverlay.classList.remove('visible');
  gameEndConfirmOverlay.setAttribute('aria-hidden', 'true');
}

function handleGameEndConfirmationKeydown(event) {
  if (!gameEndConfirmOverlay.classList.contains('visible')) return;

  // Keep confirmation-dialog keyboard input from reaching the global
  // cube-rotation handler behind the modal.
  event.stopPropagation();

  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    cancelGameEndButton.focus();
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    confirmGameEndButton.focus();
  }
}

function confirmGameEnd() {
  if (pendingGameEndAction === null) return;
  const action = pendingGameEndAction;
  hideGameEndConfirmation();
  action();
}

function resetGame() {
  if (hasGameInProgress()) {
    showGameEndConfirmation(
      'Starting a new game will leave the current game.',
      showStartScreen
    );
    return;
  }
  showStartScreen();
}

function resetView() {
  cubeGroup.rotation.set(0, 0, 0);
  setInitialCameraPosition();
  controls.target.set(0, 0, 0);
  controls.update();
  requestRender();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function getFrontmostLegalHit() {
  const hits = raycaster.intersectObjects([...cellMeshes.values()], false);
  if (!hits.length) return null;

  // Version 1.22.26: when green cubes are hidden, the hidden occupied cells
  // must also be ignored by raycasting. This makes the interaction model match
  // the visual model: the pointer can see through the absent green surfaces to
  // a legal move behind them. The nearest legal cell along the pointer ray
  // wins, including on 4×4×4.
  if (!hideGreenCubesToggle.checked) {
    for (const hit of hits) {
      const { x, y, z } = hit.object.userData;
      const cellKey = key(x, y, z);

      if (currentLegalKeys.has(cellKey)) return hit;
    }

    return null;
  }

  if (SIZE === 4) {
    // Preserve the established 4×4×4 anti-occlusion behavior exactly: an
    // occupied/green cube blocks access to anything behind it. Empty non-legal
    // cells remain transparent spacing targets.
    for (const hit of hits) {
      const { x, y, z } = hit.object.userData;
      const cellKey = key(x, y, z);

      if (currentLegalKeys.has(cellKey)) return hit;
      if (board[x][y][z] !== EMPTY) return null;
    }

    return null;
  }

  // Larger boards can have legal moves stranded inside the visually completed
  // outer surface. For 6×6×6 and 8×8×8, do not let occupied cells hide a legal
  // interior move from hover highlighting or selection. The nearest legal cell
  // along the pointer ray wins.
  for (const hit of hits) {
    const { x, y, z } = hit.object.userData;
    const cellKey = key(x, y, z);

    if (currentLegalKeys.has(cellKey)) return hit;
  }

  return null;
}

// Version 1.18.3 — prevent iPhone pull-to-refresh without interfering with
// cube dragging. The 3D game surface already uses touch-action:none, so this
// guard only suppresses downward browser refresh gestures that begin outside
// the game surface while the page is at its top edge.
let touchStartY = null;

document.addEventListener('touchstart', (event) => {
  if (event.touches.length === 1) {
    touchStartY = event.touches[0].clientY;
  } else {
    touchStartY = null;
  }
}, { passive: true });

document.addEventListener('touchmove', (event) => {
  if (touchStartY === null || event.touches.length !== 1) return;

  const currentY = event.touches[0].clientY;
  const deltaY = currentY - touchStartY;
  const gameSurface = document.getElementById('game');

  if (window.scrollY <= 0 && deltaY > 0 &&
      (!gameSurface || !gameSurface.contains(event.target))) {
    event.preventDefault();
  }
}, { passive: false });

document.addEventListener('touchend', () => {
  touchStartY = null;
}, { passive: true });

document.addEventListener('touchcancel', () => {
  touchStartY = null;
}, { passive: true });

let pointerDownPosition = null;
let pointerDownLegalKey = null;
let pointerDragged = false;
let autoRotateEnabled = false;
let hoveringOverCube = false;
let autoRotateLastTime = performance.now();
let autoRotateStopTimer = null;
const AUTO_ROTATE_TIMEOUT = 60000;

let autoRotateLastActivityTime = performance.now();

function armAutoRotateStopTimer() {
  if (autoRotateStopTimer !== null) {
    window.clearTimeout(autoRotateStopTimer);
    autoRotateStopTimer = null;
  }

  if (!autoRotateEnabled) return;

  const elapsed = performance.now() - autoRotateLastActivityTime;
  const remaining = Math.max(0, AUTO_ROTATE_TIMEOUT - elapsed);
  autoRotateStopTimer = window.setTimeout(() => {
    autoRotateStopTimer = null;

    // Re-check the activity timestamp when the timer fires so a user event
    // that occurred while the timeout was being processed cannot be lost.
    const inactiveFor = performance.now() - autoRotateLastActivityTime;
    if (autoRotateEnabled && inactiveFor >= AUTO_ROTATE_TIMEOUT) {
      autoRotateEnabled = false;
      autoRotateToggle.checked = false;
      if (!flipAnimationActive) stopContinuousRendering();
      requestRender();
    } else if (autoRotateEnabled) {
      armAutoRotateStopTimer();
    }
  }, remaining);
}

// Version 1.22.8: Make the Auto-Rotate inactivity timer robust against
// gameplay/UI event handling. Any qualifying user activity records the
// activity time directly and rearms the timer from that timestamp. The
// timeout callback also verifies the timestamp before disabling Auto-Rotate.
function noteAutoRotateActivity() {
  if (!autoRotateEnabled) return;

  const now = performance.now();
  if (now - autoRotateLastActivityTime < 100) return;
  autoRotateLastActivityTime = now;
  armAutoRotateStopTimer();
}

// Capture the events at the document/window level so activity is recognized
// even when a game/UI handler stops propagation later in the event path.
window.addEventListener('pointerdown', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('pointermove', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('pointerup', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('wheel', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('touchstart', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('touchmove', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('keydown', noteAutoRotateActivity, { passive: true, capture: true });
window.addEventListener('click', noteAutoRotateActivity, { passive: true, capture: true });

function resetAutoRotateStopTimer() {
  autoRotateLastActivityTime = performance.now();
  armAutoRotateStopTimer();
}

function cancelAutoRotateStopTimer() {
  if (autoRotateStopTimer === null) return;
  window.clearTimeout(autoRotateStopTimer);
  autoRotateStopTimer = null;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;

  // Keep camera interaction responsive while the pointer is actively down.
  startContinuousRendering();

  pointerDownPosition = { x: event.clientX, y: event.clientY };
  pointerDragged = false;

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  // Determine whether the pointer is actually over visible board geometry.
  // Auto-rotation pauses while the cursor is over the cube so the user can
  // inspect or manipulate it without the model moving underneath the pointer.
  const visibleCubeObjects = cubeGroup.children.filter((object) =>
    object.visible && (object.isMesh || object.isLineSegments) &&
    !wireframeGroup.children.includes(object)
  );
  const cubeHits = raycaster.intersectObjects(visibleCubeObjects, true);
  hoveringOverCube = cubeHits.length > 0;

  if (autoRotateEnabled && !hoveringOverCube) startContinuousRendering();
  else if (autoRotateEnabled && hoveringOverCube && !pointerDownPosition && !flipAnimationActive && !blueOpacityAnimationActive) stopContinuousRendering();

  const legalHit = getFrontmostLegalHit();

  pointerDownLegalKey = legalHit
    ? key(legalHit.object.userData.x, legalHit.object.userData.y, legalHit.object.userData.z)
    : null;
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !pointerDownPosition) return;

  const shouldMakeMove =
    !pointerDragged &&
    pointerDownLegalKey !== null &&
    currentLegalKeys.has(pointerDownLegalKey);

  if (shouldMakeMove) {
    const [x, y, z] = pointerDownLegalKey.split(',').map(Number);
    playMove(x, y, z);
  }

  pointerDownPosition = null;
  pointerDownLegalKey = null;
  pointerDragged = false;
  if (autoRotateEnabled && !hoveringOverCube) startContinuousRendering();
  else if (!autoRotateEnabled && !flipAnimationActive && !blueOpacityAnimationActive) stopContinuousRendering();
});

renderer.domElement.addEventListener('pointercancel', () => {
  if (autoRotateEnabled && !hoveringOverCube) startContinuousRendering();
  else if (!autoRotateEnabled && !flipAnimationActive && !blueOpacityAnimationActive) stopContinuousRendering();
  pointerDownPosition = null;
  pointerDownLegalKey = null;
  pointerDragged = false;
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (pointerDownPosition) {
    const dx = event.clientX - pointerDownPosition.x;
    const dy = event.clientY - pointerDownPosition.y;

    if (Math.hypot(dx, dy) > 5) {
      pointerDragged = true;
    }
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  // Refresh cube hover state continuously.  This must run on pointermove, not
  // only pointerdown, so Auto-Rotate pauses as soon as the cursor reaches any
  // visible cube geometry and resumes only after the cursor leaves the 3D area.
  const visibleCubeObjects = cubeGroup.children.filter((object) =>
    object.visible && (object.isMesh || object.isLineSegments) &&
    !wireframeGroup.children.includes(object)
  );
  const cubeHits = raycaster.intersectObjects(visibleCubeObjects, true);
  const wasHoveringOverCube = hoveringOverCube;
  hoveringOverCube = cubeHits.length > 0;

  // Keep Auto-Rotate state synchronized with the cursor while it remains
  // inside the 3D viewport. Moving off the cube must resume rendering without
  // requiring a click or leaving the viewport.
  if (autoRotateEnabled && !hoveringOverCube) {
    startContinuousRendering();
  } else if (autoRotateEnabled && hoveringOverCube && !pointerDownPosition && !flipAnimationActive && !blueOpacityAnimationActive) {
    stopContinuousRendering();
  } else if (!wasHoveringOverCube && hoveringOverCube && !pointerDownPosition && !flipAnimationActive && !blueOpacityAnimationActive) {
    stopContinuousRendering();
  }

  const legalHit = getFrontmostLegalHit();

  const nextHighlightedKey = legalHit
    ? key(legalHit.object.userData.x, legalHit.object.userData.y, legalHit.object.userData.z)
    : null;

  if (nextHighlightedKey !== highlightedLegalKey) {
    highlightedLegalKey = nextHighlightedKey;
    updateLegalCells();
  }
});

renderer.domElement.addEventListener('pointerleave', () => {
  hoveringOverCube = false;
  if (autoRotateEnabled) startContinuousRendering();
  if (highlightedLegalKey !== null) {
    highlightedLegalKey = null;
    updateLegalCells();
  }
});

let flipAnimationActive = false;
let flipAnimationStart = 0;
let flipAnimationStartY = 0;
const FLIP_ANIMATION_DURATION = 180;

function startFlipAnimation() {
  if (flipAnimationActive) return;
  flipAnimationActive = true;
  flipAnimationStart = performance.now();
  flipAnimationStartY = cubeGroup.rotation.y;
  startContinuousRendering();
}

window.addEventListener('keydown', (event) => {
  // Version 1.28.7: the Load Sequence dialog gets its own compact keyboard
  // focus cycle so the normal game's coordinate-entry Tab shortcut cannot
  // steal focus from its Load and Cancel buttons. Spacebar activates a focused
  // dialog button instead of toggling Auto-Rotate.
  if (loadSequenceOverlay.classList.contains('visible')) {
    if (event.key === 'Tab') {
      moveLoadSequenceFocus(event.shiftKey ? -1 : 1);
      event.preventDefault();
      return;
    }

    if (event.key === ' ') {
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'BUTTON' && !activeElement.disabled) {
        activeElement.click();
        event.preventDefault();
        return;
      }
    }
  }

  if (startOverlay.classList.contains('visible')) {
    if (event.key === 'Enter') {
      startGameFromSplash();
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      moveStartMenuFocus(-1);
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      moveStartMenuFocus(1);
      event.preventDefault();
      return;
    }
    if (event.key === ' ') {
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'INPUT' && activeElement.type === 'radio') {
        activeElement.checked = true;
        activeElement.dispatchEvent(new Event('change', { bubbles: true }));
        event.preventDefault();
        return;
      }
      if (activeElement?.tagName === 'BUTTON' && !activeElement.disabled) {
        activeElement.click();
        event.preventDefault();
        return;
      }
    }
  }

  if (event.key.toLowerCase() === 'h') {
    if (helpOverlay.classList.contains('visible')) {
      hideHelp();
    } else {
      showHelp();
    }
    event.preventDefault();
    return;
  }

  if (helpOverlay.classList.contains('visible')) {
    hideHelp();
    return;
  }

  // Version 1.22.18: Tab is reserved for the coordinate-entry field during
  // normal gameplay. Keep it as the only keyboard-tab destination so the
  // clickable header title and sidebar controls do not enter the tab order.
  if (event.key === 'Tab') {
    moveCoordinateInput.focus({ preventScroll: true });
    event.preventDefault();
    return;
  }

  const activeElement = document.activeElement;
  const isEditableTarget = activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.tagName === 'SELECT' ||
    activeElement.isContentEditable
  );

  if (!isEditableTarget && event.key.toLowerCase() === 'n') {
    resetGame();
    event.preventDefault();
    return;
  }

  // Version 1.25.12: view/display keyboard controls moved away from A-H
  // coordinate-entry letters. 3 toggles the 3-Axis display.
  if (!isEditableTarget && event.key === '3') {
    show3AxisToggle.checked = !show3AxisToggle.checked;
    updateOrientationMarkerVisibility();
    requestRender();
    event.preventDefault();
    return;
  }

  // Version 1.25.12: L toggles Wireframe.
  if (!isEditableTarget && event.key.toLowerCase() === 'l') {
    showWireframeToggle.checked = !showWireframeToggle.checked;
    updateWireframeVisibility();
    event.preventDefault();
    return;
  }

  // Version 1.25.12: J toggles Green Cubes.
  if (!isEditableTarget && event.key.toLowerCase() === 'j') {
    hideGreenCubesToggle.checked = !hideGreenCubesToggle.checked;
    hideGreenCubesToggle.dispatchEvent(new Event('change'));
    event.preventDefault();
    return;
  }

  // Version 1.25.12: I toggles Blue Cubes.
  // Version 1.27.19: I is a global Blue Cubes shortcut. The coordinate-entry
  // field may have focus, but I is not a valid coordinate character (Classic
  // uses A–H, and 3D boards also use A–H for X), so the display shortcut can
  // safely run even when the field is active.
  if (event.key.toLowerCase() === 'i') {
    blueCubesToggle.checked = !blueCubesToggle.checked;
    blueCubesToggle.dispatchEvent(new Event('change'));
    event.preventDefault();
    return;
  }

  if (!isEditableTarget && event.key.toLowerCase() === 'p') {
    bluePulseToggle.checked = !bluePulseToggle.checked;
    bluePulseToggle.dispatchEvent(new Event('change'));
    event.preventDefault();
    return;
  }

  // Version 1.24.6: M activates the existing Undo Move button.
  if (!isEditableTarget && event.key.toLowerCase() === 'm') {
    undoMove();
    event.preventDefault();
    return;
  }

  // Version 1.28.7: once global shortcuts that are intentionally allowed in
  // editable fields have been handled, let the browser and the focused
  // control process all remaining editing keystrokes normally. This prevents
  // Ctrl+V in the Load Sequence textarea from reaching the game-view V
  // shortcut, while preserving the existing global I shortcut above.
  if (isEditableTarget) return;

  // Version 1.25.1: K activates the existing Redo Move button/action.
  if (!isEditableTarget && event.key.toLowerCase() === 'k') {
    redoMove();
    event.preventDefault();
    return;
  }

  const step = 0.08;

  // Version 1.21.2: keyboard zoom must update the ArcballControls-managed
  // camera state without repeatedly fighting its animation/damping state.
  // Direct camera.position scaling while ArcballControls animations are active
  // can cause held-key zoom to oscillate instead of moving monotonically.
  function adjustKeyboardZoom(factor) {
    const previousAnimations = controls.enableAnimations;
    controls.enableAnimations = false;

    const offset = camera.position.clone().sub(controls.target);
    const distance = offset.length();
    const nextDistance = THREE.MathUtils.clamp(
      distance * factor,
      controls.minDistance,
      controls.maxDistance
    );

    if (distance > 0) {
      offset.multiplyScalar(nextDistance / distance);
      camera.position.copy(controls.target).add(offset);
    }

    controls.update();
    controls.enableAnimations = previousAnimations;
  }

  switch (event.key) {
      case 'ArrowLeft':
        cubeGroup.rotation.y -= step;
        break;
      case 'ArrowRight':
        cubeGroup.rotation.y += step;
        break;
      case 'ArrowUp':
        cubeGroup.rotation.x -= step;
        break;
      case 'ArrowDown':
        cubeGroup.rotation.x += step;
        break;
      // Version 1.25.12: . / / replace Q / E for Roll.
      case '.':
        cubeGroup.rotation.z -= step;
        break;
      case '/':
        cubeGroup.rotation.z += step;
        break;
      case 'r':
        resetView();
        break;
      // Version 1.25.12: V replaces F for Flip 180°.
      case 'v':
        startFlipAnimation();
        break;
      case ' ':
        autoRotateEnabled = !autoRotateEnabled;
        autoRotateToggle.checked = autoRotateEnabled;
        if (autoRotateEnabled) {
          resetAutoRotateStopTimer();
          if (!hoveringOverCube) startContinuousRendering();
        } else {
          cancelAutoRotateStopTimer();
          if (!flipAnimationActive) stopContinuousRendering();
        }
        break;
      case '-':
      case '_':
        adjustKeyboardZoom(1.1);
        break;
      case '=':
      case '+':
        adjustKeyboardZoom(0.9);
        break;
      default:
        return;
    }

  requestRender();
  event.preventDefault();
});

passOverlay.addEventListener('click', dismissPassMessage);

moveCoordinateInput.addEventListener('keydown', handleCoordinateInputKey);

moveCoordinateInput.addEventListener('paste', (event) => {
  event.preventDefault();
});

moveCoordinateInput.addEventListener('drop', (event) => {
  event.preventDefault();
});

moveEntry.addEventListener('submit', (event) => {
  event.preventDefault();
  submitCoordinateMove();
});

autoRotateToggle.addEventListener('change', () => {
  autoRotateEnabled = autoRotateToggle.checked;
  if (autoRotateEnabled) {
    resetAutoRotateStopTimer();
    if (!hoveringOverCube) startContinuousRendering();
  } else {
    cancelAutoRotateStopTimer();
    if (!flipAnimationActive) stopContinuousRendering();
  }
  requestRender();
});

undoButton.addEventListener('click', undoMove);
redoButton.addEventListener('click', redoMove);
moveSequenceButton.addEventListener('click', showMoveSequence);
loadSequenceButton.addEventListener('click', showLoadSequence);
startLoadSequenceButton.addEventListener('click', showLoadSequenceFromStartScreen);
closeSequenceButton.addEventListener('click', hideMoveSequence);
copySequenceButton.addEventListener('click', copyMoveSequence);
loadSequenceButtonConfirm.addEventListener('click', loadMoveSequence);
loadedPlayerModeInputs.forEach((input) => {
  input.addEventListener('change', updateLoadedSequenceDifficultyVisibility);
});

loadedSequenceChoiceContinue.addEventListener('click', continueLoadedSequence);
cancelLoadSequenceButton.addEventListener('click', hideLoadSequence);
sequenceOverlay.addEventListener('click', (event) => {
  if (event.target === sequenceOverlay) hideMoveSequence();
});

loadSequenceOverlay.addEventListener('click', (event) => {
  if (event.target === loadSequenceOverlay) hideLoadSequence();
});

confirmGameEndButton.addEventListener('click', confirmGameEnd);
cancelGameEndButton.addEventListener('click', hideGameEndConfirmation);
gameEndConfirmOverlay.addEventListener('keydown', handleGameEndConfirmationKeydown);
gameEndConfirmOverlay.addEventListener('click', (event) => {
  if (event.target === gameEndConfirmOverlay) hideGameEndConfirmation();
});

helpOverlay.addEventListener('click', (event) => {
  if (!helpPanel.contains(event.target)) hideHelp();
});

blueCubesToggle.addEventListener('change', () => {
  if (legalSurface) {
    legalSurface.visible = blueCubesToggle.checked;
  }
  requestRender();
});

bluePulseToggle.addEventListener('change', () => {
  if (bluePulseToggle.checked) {
    if (gameInProgress && currentLegalKeys.size > 0) {
      startBlueOpacityAnimation();
    }
  } else {
    blueOpacityAnimationActive = false;
    if (blueOpacityStopTimer !== null) {
      window.clearTimeout(blueOpacityStopTimer);
      blueOpacityStopTimer = null;
    }
    if (legalSurface) legalSurface.material.opacity = getLegalSurfaceOpacity();
    if (!autoRotateEnabled && !flipAnimationActive) stopContinuousRendering();
  }
  requestRender();
});

show3AxisToggle.addEventListener('change', () => {
  updateOrientationMarkerVisibility();
  requestRender();
});

showWireframeToggle.addEventListener('change', updateWireframeVisibility);

hideGreenCubesToggle.addEventListener('change', () => {
  if (occupiedSurface) {
    occupiedSurface.visible = hideGreenCubesToggle.checked;
  }
  requestRender();
});

opponentModeInputs.forEach((input) => {
  input.addEventListener('change', updateStartScreenOptions);
});

developerModeToggle.addEventListener('change', () => {
  developerMode = developerModeToggle.checked;
  updateBotDeveloperPanel();
});
bookOpeningsToggle.addEventListener('change', () => {
  bookOpeningsEnabled = bookOpeningsToggle.checked;
  updateBookOpeningLabel();
});
copyBotDeveloperButton.addEventListener('click', copyBotDeveloperSummary);
startGameButton.addEventListener('click', startGameFromSplash);
resetButton.addEventListener('click', resetGame);
brandTitle.addEventListener('click', resetGame);
brandLogo.addEventListener('click', resetGame);
brandTitle.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    resetGame();
  }
});
resignButton.addEventListener('click', resignGame);
confirmResignButton.addEventListener('click', confirmResignation);
cancelResignButton.addEventListener('click', hideResignConfirmation);
resignConfirmOverlay.addEventListener('click', (event) => {
  if (event.target === resignConfirmOverlay) hideResignConfirmation();
});

window.addEventListener('resize', () => {
  const width = sceneElement.clientWidth;
  const height = sceneElement.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  updateOrientationMarkerVisibility();
  requestRender();
});

for (let x = 0; x < SIZE; x++) {
  for (let y = 0; y < SIZE; y++) {
    for (let z = 0; z < BOARD_DEPTH; z++) {
      createCell(x, y, z);
    }
  }
}

makeInitialPosition();
updatePieces();
updateOccupiedSurface();
updateLegalCells();
updateStatus();

// Version 1.12.0: the board is prepared behind the splash, but the game does
// not begin until the player confirms the start-screen choices.
updateStartScreenOptions();
startOverlay.classList.add('visible');
startOverlay.setAttribute('aria-hidden', 'false');
// Version 1.21.2: Start Game remains the keyboard-focused element on initial load;
// arrow keys navigate the start menu and Spacebar cycles focused radio groups.
requestAnimationFrame(() => startGameButton.focus({ preventScroll: true }));

function animate(now) {
  // Continuous rendering is entered only for active visual animation.
  const elapsedSeconds = Math.min((now - autoRotateLastTime) / 1000, 0.1);
  autoRotateLastTime = now;

  if (flipAnimationActive) {
    const t = Math.min((now - flipAnimationStart) / FLIP_ANIMATION_DURATION, 1);
    const easedT = t * t * (3 - 2 * t);
    cubeGroup.rotation.y = flipAnimationStartY + Math.PI * easedT;
    if (t >= 1) {
      flipAnimationActive = false;
      cubeGroup.rotation.y = flipAnimationStartY + Math.PI;
    }
  } else if (autoRotateEnabled && !hoveringOverCube) {
    // Auto-Rotate values are unchanged from the confirmed 1.20.36 baseline.
    const frameScale = elapsedSeconds * 60;
    cubeGroup.rotation.y += 0.003 * frameScale;
    cubeGroup.rotation.x += 0.0065 * frameScale;
    cubeGroup.rotation.z += 0.002 * frameScale;
  }

  controls.update();

  if (blueOpacityAnimationActive && legalSurface) {
    legalSurface.material.opacity = getBlueOpacity(now);
  }

  if (lastMoveMarker) {
    lastMoveMarker.material.dashOffset -= 0.012;
  }

  renderScene();

  if (!flipAnimationActive && !blueOpacityAnimationActive && (!autoRotateEnabled || hoveringOverCube)) {
    stopContinuousRendering();
  }
}

updateUndoButton();
updateRedoButton();
updateVersionLabel();
requestRender();
