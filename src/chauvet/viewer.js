import { createMultiLampUI } from '../multi-lamp-ui.js';
import { createRecordingTabs } from '../recording-tabs.js';
import { createLampComparison } from '../lamp-comparison.js';
import { lampPairs } from './lamp-pairs.js';
import {
  Box3, DoubleSide, Matrix3, MeshBasicMaterial, PerspectiveCamera, Ray, Raycaster,
  Scene, Vector2, Vector3, WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { downloadScan } from '../scan-download.js';
import { createCaveLight } from './cave-light.js';
import { createCaveCollision, LAMP_RADIUS } from './collision.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status-message');
const description = document.querySelector('#description');
const buttons = [...document.querySelectorAll('[data-view]')];
const reset = document.querySelector('#reset');
const retry = document.querySelector('#retry-scan');
const caveControls = document.querySelector('#cave-controls');
const caveLocation = document.querySelector('#cave-location');
const placeLamp = document.querySelector('#place-lamp');
const placementNote = document.querySelector('#placement-note');
const followLamp = document.querySelector('#follow-lamp');
const lampMenu = document.querySelector('#lamp-context-menu');
const bringLamp = document.querySelector('#bring-lamp-here');
const lampMenuNote = document.querySelector('#lamp-context-note');
const runtimePath = '/lascaux-assets/';
const modelPaths = {
  cave: '/api/shared-media/scans/chauvet/horses-fresco-v1.glb'
};
function room(id, { wick, limits, axes, ...view }) {
  return {
    id, ...view,
    start: new Vector3(...wick),
    bounds: axes.map(([axis, sign], index) => ({ axis, sign, min: limits[index][0], max: limits[index][1] }))
  };
}

const rooms = {
  shaft: room('shaft', {
    label: 'Hillaire Chamber', fov: 47,
    description: 'Horses Fresco · Hillaire Chamber',
    target: [-0.271, 7.087, -2.410], position: [3.684, 6.138, -6.098],
    wick: [0.15, 6.65, -2.72], intensity: 7,
    axes: [['x', 1], ['y', 1], ['z', 1]],
    limits: [[-1, 1], [5.7, 7.9], [-3.7, -1.7]]
  }),
  bison: room('bison', {
    label: 'Eight-legged bison', fov: 36,
    description: 'Eight-legged bison · Right wall of the Alcove of the Lions',
    target: [-1.204, 7.08, -2.401], position: [0.50, 6.62, -2.18],
    wick: [-0.75, 6.65, -2.30], intensity: 2.4,
    axes: [['x', 1], ['y', 1], ['z', 1]],
    limits: [[-1, 1], [5.7, 7.9], [-3.7, -1.7]]
  }),
  hall: room('hall', {
    label: 'Hall of the Bulls', fov: 58,
    description: 'Inside the Hall of the Bulls.',
    target: [0.15, 2.05, -10.2], position: [-0.465, 1.23, -4.909],
    wick: [0.15, 1.20, -7.50], intensity: 5.4,
    axes: [['x', 1], ['y', 1], ['z', 1]],
    limits: [[-1.30, 0.90], [1.00, 1.80], [-10.50, -6.30]]
  }),
  axial: room('axial', {
    label: 'Axial Gallery', fov: 58,
    description: 'Inside the Axial Gallery, near the Chinese Horses panel.',
    target: [0.85, 1.48, -15.25], position: [-0.202, 0.962, -12.69],
    wick: [-0.10, 0.70, -13.69], intensity: 4.5,
    axes: [['x', 1], ['y', 1], ['z', 1]],
    limits: [[-0.55, 0.35], [0.25, 1.15], [-14.14, -13.24]]
  }),
  nave: room('nave', {
    label: 'Nave', fov: 58,
    description: 'Inside the Nave, near the Great Black Cow panel.',
    target: [22.203, -1.615, -23.626], position: [22.026, -2.098, -20.670],
    wick: [22.10, -2.25, -21.87], intensity: 5.4,
    axes: [['x', 1], ['y', 1], ['z', 1]],
    limits: [[21.35, 22.85], [-3.23, -1.73], [-22.40, -20.90]]
  })
};

const overview = {
  label: 'Whole cave', fov: 43,
  description: 'The cave from above. Use Place lamp to reach another chamber, or Follow lamp to move it up close.'
};

const modes = {
  shaft: { asset: 'cave', label: rooms.shaft.label },
  bison: { asset: 'cave', label: rooms.bison.label },
  cave: { asset: 'cave', label: overview.label },
  hall: { asset: 'cave', label: rooms.hall.label }
};

function configureViewer() {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x181b19);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.setAttribute('aria-label', 'Interactive view of the Chauvet Horses Fresco');
  stage.prepend(renderer.domElement);
  const camera = new PerspectiveCamera(43, 1, 0.025, 600);
  const scene = new Scene();
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.16;
  controls.zoomToCursor = true;
  controls.minDistance = 0.12;
  controls.maxDistance = 300;

  const ktx2 = new KTX2Loader()
    .setTranscoderPath(`${runtimePath}basis/`)
    .setWorkerLimit(2)
    .detectSupport(renderer);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  const loaded = new Map();
  let active = null;
  let requestedMode;
  let displayed = null;
  let selection = 0;
  let renderPending = false;
  let caveLight;
  let lastCaveRoom = 'axial';
  let placingLamp = false;
  let placementId = 0;
  let placementPress = null;
  let placementRequest = 0;
  let rightPress = null;
  let menuSurface = null;
  let caveCollision = null;
  let collisionPromise = null;
  let following = false;
  let followId = 0;

  function render() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(now => {
      renderPending = false;
      controls.update();
      caveLight?.frame(now);
      renderer.render(scene, camera);
    });
  }

  caveLight = createCaveLight({ scene, camera, stage, controls, render, loadCollision, onMove: followCamera });
  const loadTraces = createRecordingTabs(caveLight, runtimePath);
  createMultiLampUI(caveLight, loadTraces);
  let comparisonFocus = null;
  function comparisonFov(fov) {
    if (camera.aspect >= 1) return fov;
    return Math.atan(Math.tan(fov * Math.PI / 360) / camera.aspect) * 360 / Math.PI;
  }
  const comparison = createLampComparison({
    stage,
    loadCollision,
    apply: (state, alternating) => caveLight.applyComparison(new Vector3(...state.position), state, alternating),
    focus: pair => {
      comparisonFocus = pair;
      const preset = viewPreset(active);
      controls.target.fromArray(pair.target);
      camera.position.fromArray(pair.camera ?? preset.position);
      camera.fov = comparisonFov(pair.fov);
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      controls.update();
      render();
    }
  });
  controls.addEventListener('change', render);
  new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    if (comparisonFocus) camera.fov = comparisonFov(comparisonFocus.fov);
    else if (active === 'bison') camera.fov = fieldOfView(rooms.bison);
    camera.updateProjectionMatrix();
    render();
  }).observe(stage);

  function viewPreset(mode) {
    if (mode !== 'cave') return rooms[mode];
    return caveLocation.value === 'overview' ? overview : rooms[caveLocation.value];
  }

  function fieldOfView(preset) {
    if (preset !== rooms.bison || camera.aspect >= 1) return preset.fov;
    const halfAngle = preset.fov * Math.PI / 360;
    return Math.atan(Math.tan(halfAngle) / camera.aspect) * 360 / Math.PI;
  }

  function positionCamera(mode) {
    comparisonFocus = null;
    const preset = viewPreset(mode);
    camera.fov = fieldOfView(preset);
    camera.updateProjectionMatrix();
    if (preset.position) {
      controls.target.fromArray(preset.target);
      camera.position.fromArray(preset.position);
      if (preset === rooms.shaft && camera.aspect < 1.05) {
        camera.position.sub(controls.target).multiplyScalar(1.3).add(controls.target);
      }
    } else {
      const bounds = new Box3().setFromObject(displayed);
      const size = bounds.getSize(new Vector3());
      bounds.getCenter(controls.target);
      const distance = Math.max(size.x, size.z) * Math.max(1.28, 1.15 / camera.aspect, camera.aspect < 1 ? 1.92 / camera.aspect : 0);
      camera.position.copy(controls.target).add(
        new Vector3(0.52, 1.18, 0.65).normalize().multiplyScalar(distance)
      );
    }
    camera.lookAt(controls.target);
    controls.update();
    render();
  }

  function prepareModel(object) {
    const omittedNodes = [];
    object.traverse(node => {
      if (node.isLight) omittedNodes.push(node);
      if (!node.isMesh) return;
      // This GLB includes an untextured backing mesh that can cover the painted surface.
      if (!Array.isArray(node.material) && node.material.name === 'None_NONE' && !node.material.map) {
        omittedNodes.push(node);
        return;
      }
      const inspectable = material => new MeshBasicMaterial({
        map: material.map,
        color: material.color,
        side: DoubleSide
      });
      node.material = Array.isArray(node.material)
        ? node.material.map(inspectable) : inspectable(node.material);
    });
    omittedNodes.forEach(node => node.removeFromParent());
    caveLight.attach(object);
    return object;
  }

  async function loadModel(asset) {
    const bytes = await downloadScan(modelPaths[asset]);
    const { scene: object } = await loader.parseAsync(bytes, '');
    return prepareModel(object);
  }

  function getModel(asset) {
    if (!loaded.has(asset)) {
      const pending = loadModel(asset).catch(error => { loaded.delete(asset); throw error; });
      loaded.set(asset, pending);
    }
    return loaded.get(asset);
  }

  function loadCollision() {
    if (!collisionPromise) {
      collisionPromise = getModel('cave').then(async object => {
        // Let the status render before indexing the full cave.
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        caveCollision = createCaveCollision(object);
        caveLight.setCollision(caveCollision);
        return caveCollision;
      }).catch(error => { collisionPromise = null; throw error; });
    }
    return collisionPromise;
  }

  function followCamera(position) {
    if (!following) return;
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 0.0025) offset.set(0, 0.1, 1);
    offset.normalize();
    const distance = 2.35;
    const wall = caveCollision?.raycast(new Ray(position, offset), distance + 0.1);
    const available = wall ? Math.max(0.045, Math.min(distance, wall.distance - 0.06)) : distance;
    controls.target.copy(position);
    camera.position.copy(position).addScaledVector(offset, available);
    camera.lookAt(position);
    controls.update();
    render();
  }

  function setFollowing(next) {
    following = next;
    followLamp.setAttribute('aria-pressed', String(next));
    followLamp.textContent = next ? 'Stop following' : 'Follow lamp';
  }

  followLamp.addEventListener('click', async () => {
    if (following) { setFollowing(false); return; }
    const wick = caveLight.position();
    if (!wick) return;
    const previousMode = active;
    const previousSelection = selection;
    followLamp.disabled = true;
    followLamp.textContent = 'Opening cave…';
    try {
      await loadCollision();
      if (previousSelection !== selection || previousMode !== active) return;
      const position = caveLight.position() ?? wick;
      const fromOverview = viewPreset(active) === overview;
      const pose = fromOverview ? rooms[lastCaveRoom] : viewPreset(active);
      const offset = fromOverview
        ? new Vector3().fromArray(pose.position).sub(new Vector3().fromArray(pose.target))
        : camera.position.clone().sub(controls.target);
      rooms.follow = {
        ...rooms.hall, id: `follow-${++followId}`, label: 'Near lamp', fov: 58,
        description: 'Follow the lamp through the cave.', start: position,
        target: position.toArray(),
        position: position.clone().add(offset.normalize()).toArray(),
        intensity: pose.intensity ?? 4.5
      };
      caveLocation.querySelector('[value="follow"]').hidden = false;
      caveLocation.value = 'follow';
      lastCaveRoom = 'follow';
      setFollowing(true);
      if (active === 'cave') displayView('cave');
      else await show('cave', { keepFollowing: true });
    } catch (error) {
      console.error(error);
      setFollowing(false);
    } finally {
      followLamp.disabled = false;
      setFollowing(following);
    }
  });

  async function show(mode, { keepFollowing = false } = {}) {
    loadTraces();
    if (mode === active && !status.textContent) return;
    requestedMode = mode;
    retry.hidden = true;
    const request = ++selection;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === mode)));
    description.textContent = viewPreset(mode).description;
    stopPlacement();
    if (!keepFollowing) setFollowing(false);
    status.textContent = `Opening ${modes[mode].label.toLowerCase()}…`;
    stage.dataset.loading = "";
    reset.disabled = true;
    comparison.show(null);
    caveLight.show(null);
    try {
      // Paint the loading overlay before downloading or decoding the scan.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (request !== selection) return;
      const { asset } = modes[mode];
      const object = await getModel(asset);
      if (request !== selection) return;
      if (displayed !== object) {
        if (displayed) scene.remove(displayed);
        scene.add(object);
        displayed = object;
      }
      active = mode;
      displayView(mode);
      delete stage.dataset.loading;
      status.textContent = '';
      reset.disabled = false;
      stage.dataset.active = mode;
      if (asset === 'cave') loadCollision().catch(() => {});
    } catch (error) {
      if (request !== selection) return;
      delete stage.dataset.loading;
      console.error(error);
      status.textContent = `Could not open ${modes[mode].label.toLowerCase()}. Choose Retry scan to try again.`;
      retry.hidden = false;
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === active)));
      reset.disabled = !active;
      if (active) displayView(active);
    }
  }

  function displayView(mode) {
    stopPlacement();
    const preset = viewPreset(mode);
    caveControls.hidden = mode !== 'cave';
    description.textContent = preset.description;
    positionCamera(mode);
    caveLight.show(preset === overview ? rooms[lastCaveRoom] : preset, {
      fromAbove: preset === overview,
      usePrecisionSliders: true
    });
    comparison.show(lampPairs[preset.id]);
    if (following && preset === rooms.follow) followCamera(caveLight.position());
  }

  caveLocation.addEventListener('change', () => {
    stopPlacement();
    setFollowing(caveLocation.value === 'follow');
    if (caveLocation.value !== 'overview') lastCaveRoom = caveLocation.value;
    if (active === 'cave') displayView('cave');
  });
  function stopPlacement() {
    placementRequest++;
    rightPress = null;
    closeLampMenu();
    placingLamp = false;
    placeLamp.setAttribute('aria-pressed', 'false');
    stage.classList.remove('placing-lamp');
    placementNote.textContent = '';
  }

  placeLamp.addEventListener('click', () => {
    if (placingLamp) { stopPlacement(); return; }
    stopPlacement();
    placingLamp = true;
    placeLamp.setAttribute('aria-pressed', 'true');
    stage.classList.add('placing-lamp');
    placementNote.textContent = 'Select a cave surface to place the lamp nearby.';
  });

  renderer.domElement.addEventListener('pointerdown', event => {
    placementPress = placingLamp ? [event.clientX, event.clientY] : null;
    if (!placingLamp) stage.focus({ preventScroll: true });
  });
  function pickSurface(clientX, clientY) {
    if (!displayed || !caveLight.position()) return null;
    const frame = renderer.domElement.getBoundingClientRect();
    const click = new Vector2((clientX - frame.left) / frame.width * 2 - 1,
      1 - (clientY - frame.top) / frame.height * 2);
    const ray = new Raycaster();
    ray.setFromCamera(click, camera);
    const surface = ray.intersectObject(displayed, true)[0];
    if (!surface) return null;
    const normal = surface.face.normal.clone()
      .applyMatrix3(new Matrix3().getNormalMatrix(surface.object.matrixWorld)).normalize();
    if (normal.dot(ray.ray.direction.clone().negate()) < 0) {
      normal.negate();
    }
    return { point: surface.point, normal, distance: surface.distance, towardsCamera: ray.ray.direction.clone().negate() };
  }

  function clearWick(surface, collision, detail) {
    const { point, normal, towardsCamera, distance } = surface;
    // Prefer the cursor ray. Use the inward normal at grazing angles or from behind the Shaft tile.
    for (const [direction, maxDistance] of [[towardsCamera, Math.min(0.75, distance - 0.06)], [normal, 0.75]]) {
      const alignment = direction.dot(normal);
      if (alignment < 0.35) continue;
      const inset = 0.06;
      const probe = new Ray(point.clone().addScaledVector(direction, inset), direction);
      const nextWall = Math.min(collision.raycast(probe, 1)?.distance ?? Infinity,
        detail?.raycast(probe, 1)?.distance ?? Infinity);
      const limit = Math.min(maxDistance, nextWall + inset - LAMP_RADIUS);
      for (const clearance of [0.26, 0.34, 0.45, 0.205]) {
        const offset = clearance / alignment;
        if (offset > limit) continue;
        const wick = point.clone().addScaledVector(direction, offset);
        if (collision.bounds.containsPoint(wick) && collision.isClear(wick) && (!detail || detail.isClear(wick))) {
          return wick;
        }
      }
    }
    return null;
  }

  async function placePickedSurface(surface, openCloseView) {
    if (!surface) {
      placementNote.textContent = 'Select a visible part of the cave.';
      return;
    }
    const request = ++placementRequest;
    placementNote.textContent = 'Checking room for the lamp…';
    let collision;
    try {
      collision = await loadCollision();
      if (request !== placementRequest) return;
    } catch (error) {
      console.error(error);
      if (request === placementRequest) placementNote.textContent = 'Could not check the cave boundaries. Try again.';
      return;
    }
    if (!openCloseView) {
      const wick = clearWick(surface, collision, null);
      if (!wick || !caveLight.relocate(wick)) {
        placementNote.textContent = 'Try a wider part of the chamber.';
        return;
      }
      stopPlacement();
      placementNote.textContent = 'Lamp moved.';
      return;
    }
    const { point, normal } = surface;
    const ray = new Raycaster(point.clone().addScaledVector(normal, 0.04), normal);
    const opposite = ray.intersectObject(displayed, true)[0];
    const clearance = opposite ? opposite.distance + 0.04 : 3;
    const wick = point.clone().addScaledVector(normal, Math.min(0.75, clearance * 0.40));
    if (clearance < 0.32 || !collision.isClear(wick)) {
      placementNote.textContent = 'Try a wider part of the chamber.';
      return;
    }
    const position = point.clone().addScaledVector(normal, Math.min(2.0, clearance * 0.80));
    const depth = Math.abs(normal.x) > Math.abs(normal.z) ? 'x' : 'z';
    const side = depth === 'x' ? 'z' : 'x';
    const range = Math.min(0.35, clearance * 0.15);
    rooms.placed = room(`placed-${++placementId}`, {
      label: 'Near placed lamp', fov: 58,
      description: 'A close view of the surface next to your lamp.',
      target: point.toArray(), position: position.toArray(), wick: wick.toArray(),
      axes: [[side, 1], ['y', 1], [depth, 1]],
      limits: [side, 'y', depth].map(axis => [wick[axis] - range, wick[axis] + range])
    });
    caveLocation.querySelector('[value="placed"]').hidden = false;
    caveLocation.value = 'placed';
    lastCaveRoom = 'placed';
    stopPlacement();
    displayView('cave');
  }

  renderer.domElement.addEventListener('click', event => {
    if (!placingLamp || !caveLight.position()) return;
    if (placementPress && Math.hypot(event.clientX - placementPress[0], event.clientY - placementPress[1]) > 8) return;
    void placePickedSurface(pickSurface(event.clientX, event.clientY), viewPreset(active) === overview);
  });

  function closeLampMenu(restoreFocus = false) {
    if (!lampMenu || lampMenu.hidden) return;
    lampMenu.hidden = true;
    menuSurface = null;
    if (restoreFocus) stage.focus({ preventScroll: true });
  }

  if (lampMenu) {
    const isScene = target => target === renderer.domElement || target === stage || target.closest('.light-marker');
    function openLampMenu(x, y) {
      const rect = stage.getBoundingClientRect();
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return;
      menuSurface = pickSurface(x, y);
      bringLamp.disabled = !menuSurface;
      lampMenuNote.textContent = menuSurface ? '' : 'Choose a visible cave surface.';
      lampMenu.hidden = false;
      const left = Math.min(x - rect.left, Math.min(rect.width, innerWidth - rect.left) - lampMenu.offsetWidth - 6);
      const top = Math.min(y - rect.top, Math.min(rect.height, innerHeight - rect.top) - lampMenu.offsetHeight - 6);
      lampMenu.style.left = `${Math.max(6, 6 - rect.left, left)}px`;
      lampMenu.style.top = `${Math.max(6, 6 - rect.top, top)}px`;
      (menuSurface ? bringLamp : lampMenu).focus({ preventScroll: true });
    }
    stage.addEventListener('contextmenu', event => {
      if (isScene(event.target) || lampMenu.contains(event.target)) event.preventDefault();
    });
    stage.addEventListener('pointerdown', event => {
      if (event.button === 2 && isScene(event.target)) {
        rightPress = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      }
    });
    document.addEventListener('pointermove', event => {
      if (rightPress?.id === event.pointerId &&
          Math.hypot(event.clientX - rightPress.x, event.clientY - rightPress.y) > 6) rightPress.moved = true;
    });
    document.addEventListener('pointerup', event => {
      if (event.button !== 2 || rightPress?.id !== event.pointerId) return;
      const press = rightPress;
      rightPress = null;
      if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 6) {
        openLampMenu(event.clientX, event.clientY);
      }
    });
    document.addEventListener('pointercancel', event => {
      if (rightPress?.id === event.pointerId) rightPress = null;
    });
    document.addEventListener('pointerdown', event => {
      if (!lampMenu.contains(event.target)) closeLampMenu();
    });
    stage.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !lampMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeLampMenu(true);
      } else if (isScene(event.target) && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault();
        const rect = stage.getBoundingClientRect();
        openLampMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    });
    bringLamp.addEventListener('click', () => {
      const surface = menuSurface;
      if (!surface) return;
      closeLampMenu(true);
      stopPlacement();
      void placePickedSurface(surface, false);
    });
  }
  const modeFromHash = () => location.hash === '#bison' ? 'bison' : 'shaft';
  buttons.forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.view;
    history.replaceState(null, '', mode === 'bison' ? '#bison' : location.pathname + location.search);
    if (mode === active && !status.textContent) {
      positionCamera(mode);
    } else {
      void show(mode);
    }
  }));
  window.addEventListener('hashchange', () => void show(modeFromHash()));
  retry.addEventListener('click', () => void show(requestedMode));
  reset.addEventListener('click', () => {
    if (!active) return;
    positionCamera(active);
    if (following) followCamera(caveLight.position());
  });
  show(modeFromHash());
}

function configureFullscreen() {
  const viewer = document.querySelector('#viewer');
  const toggle = document.querySelector('#toggle-fullscreen');
  if (!toggle) return;
  const label = toggle.querySelector('span');
  let changing = false;
  const expanded = () => document.body.classList.contains('viewer-expanded');
  const native = () => document.fullscreenElement === viewer;

  function updateButton() {
    label.textContent = native() || expanded() ? 'Exit fullscreen' : 'Fullscreen';
  }

  function expand(enabled) {
    document.body.classList.toggle('viewer-expanded', enabled);
    updateButton();
    toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', async () => {
    if (changing) return;
    changing = true;
    try {
      if (native()) {
        await document.exitFullscreen();
      } else if (expanded()) {
        expand(false);
      } else if (document.fullscreenEnabled && viewer.requestFullscreen) {
        try {
          await viewer.requestFullscreen();
        } catch {
          expand(true);
        }
      } else {
        expand(true);
      }
    } catch (error) {
      console.error(error);
    } finally {
      changing = false;
    }
  });

  document.addEventListener('fullscreenchange', updateButton);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && (native() || expanded())) toggle.click();
  });
  toggle.hidden = false;
}

try {
  configureViewer();
  configureFullscreen();
} catch (error) {
  console.error(error);
  delete stage.dataset.loading;
  status.textContent = 'This viewer needs a browser with WebGL 2 enabled. Try opening it in Chrome.';
}
