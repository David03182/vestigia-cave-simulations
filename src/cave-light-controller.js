import { AmbientLight, Group, MeshLambertMaterial, Plane, PointLight, Raycaster, Vector2, Vector3 } from 'three';
import { MAX_LAMPS, advanceRecording, installRecordings, recordingDuration, recordingSample, selectRecording } from './lamp-playback.js';
import { applyLampLighting } from './lamp-lighting.js';

export function createCaveLightController({ scene, camera, stage, controls, render, loadCollision, onMove, onLampChange, createLamp, createFlame, lampRadius, positionSuffix = ' m' }) {
  const panel = document.querySelector('#shaft-controls');
  const navigation = document.querySelector('#lamp-navigation');
  const firstMarker = document.querySelector('#light-marker');
  const survey = document.querySelector('#survey-light');
  const steady = document.querySelector('#steady-light');
  const play = document.querySelector('#play-light');
  const picker = document.querySelector('#lamp-recording');
  const time = document.querySelector('#lamp-time');
  const timeReadout = document.querySelector('#lamp-time-value');
  const level = document.querySelector('#lamp-level');
  const brightnessInput = document.querySelector('#lamp-brightness');
  const brightnessReadout = document.querySelector('#lamp-brightness-value');
  const strengthInput = document.querySelector('#lamp-flicker-strength');
  const strengthReadout = document.querySelector('#lamp-flicker-strength-value');
  const reset = document.querySelector('#reset-lamp');
  const frequency = document.querySelector('#lamp-frequency');
  const frequencyLabel = document.querySelector('#lamp-frequency-label');
  const frequencyHelp = document.querySelector('#frequency-help');
  const fireHelp = document.querySelector('#fire-help');
  const lampFrequencyHelp = frequencyHelp.textContent;
  const frequencyReadout = document.querySelector('#lamp-frequency-value');
  const recordedSpeed = document.querySelector('#recorded-speed');
  const positionInputs = [...panel.querySelectorAll('[data-position]')];
  const moveNote = document.querySelector('#lamp-movement-note');
  const jogButtons = [...document.querySelectorAll('[data-jog]')];
  const held = new Map();
  const motion = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3(0, 1, 0);
  const keys = { w: 'forward', s: 'back', a: 'left', d: 'right', q: 'down', e: 'up',
    arrowup: 'forward', arrowdown: 'back', arrowleft: 'left', arrowright: 'right' };
  const lights = new Group();
  const ambient = new AmbientLight(0xffffff, 0.025);
  const lampSamples = { value: new Float32Array(MAX_LAMPS) };
  const recordingCache = new Map();
  const materials = [];
  const sliderRadius = 1;
  const projected = new Vector3();
  const pointer = new Vector2();
  const hit = new Vector3();
  const plane = new Plane();
  const planeNormal = new Vector3();
  const ray = new Raycaster();
  const timeFormat = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const voltageFormat = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero'
  });
  let motionTime = 0;
  let collision = null;
  let collisionPending = null;
  let queuedMove = null;
  let room = null;
  let overview = false;
  let preciseMovement = false;
  let drag = null;
  let visible = false;
  let lampCount = 1;
  let selectedIndex = 0;
  let shadowsEnabled = true;
  let surveyView = false;

  const lamps = Array.from({ length: MAX_LAMPS }, (_, index) => {
    const light = new PointLight(0xffc28b, 0, 0, 2);
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.08;
    light.shadow.camera.far = 25;
    light.shadow.bias = -0.0003;
    light.shadow.normalBias = 0.025;
    light.shadow.autoUpdate = false;
    const brightness = { value: 1 };
    const flameSample = { value: 0 };
    const body = createLamp();
    body.rotation.y = Math.PI / 4;
    const flame = createFlame(flameSample, brightness);
    light.add(body, flame);
    lights.add(light);
    const marker = index ? firstMarker.cloneNode(true) : firstMarker;
    marker.id = index ? `light-marker-${index + 1}` : 'light-marker';
    marker.classList.add('light-marker');
    marker.dataset.lampIndex = String(index);
    marker.setAttribute('aria-label', `Select and drag lamp ${index + 1}. Position sliders are below the scene.`);
    marker.querySelector('span').textContent = String(index + 1);
    marker.querySelector('span').classList.add('lamp-number');
    marker.hidden = true;
    if (index) firstMarker.after(marker);
    return {
      index, light, marker, body, flame, brightness, flameSample,
      source: 'lamp', mode: 'steady', running: false, lastFrame: 0,
      brightnessPercent: brightnessInput?.valueAsNumber ?? 100,
      strengthPercent: strengthInput?.valueAsNumber ?? 100,
      selectedFrequency: null, elapsed: 0, traceIndex: index,
      traces: [], recording: null, recordingUnavailable: false,
      previewScaleUv: 1, traceScaleUv: 1,
      positionByRoom: new Map(), foundRooms: new WeakSet(), sliderCentre: new Vector3()
    };
  });
  let selected = lamps[0];
  lights.add(ambient);
  scene.add(lights);

  function states() {
    return lamps.map(lamp => ({
      index: lamp.index, active: lamp.index < lampCount, selected: lamp === selected,
      source: lamp.source, mode: lamp.mode, running: lamp.running, surveyView,
      brightness: lamp.brightnessPercent, strength: lamp.strengthPercent,
      selectedFrequency: lamp.selectedFrequency, elapsed: lamp.elapsed,
      traceIndex: lamp.traceIndex, recordingReady: Boolean(lamp.recording),
      position: room ? lamp.light.position.toArray() : null,
      sample: recordingSample(lamp), intensity: lamp.light.intensity
    }));
  }

  function notifySelection() {
    const all = states();
    onLampChange?.({ ...all[selectedIndex], count: lampCount, surveyView, lamps: all });
  }

  function invalidateShadows() {
    for (const lamp of lamps) lamp.light.shadow.needsUpdate = true;
  }

  function syncPosition() {
    if (!room) return;
    for (const [index, input] of positionInputs.entries()) {
      const { axis, sign, min, max } = room.bounds[index];
      const start = room.start[axis];
      let lower = collision?.bounds.min[axis] ?? min;
      let upper = collision?.bounds.max[axis] ?? max;
      if (preciseMovement) {
        const position = selected.light.position[axis];
        if (Math.abs(position - selected.sliderCentre[axis]) > sliderRadius + 0.005) selected.sliderCentre[axis] = position;
        lower = Math.max(lower, selected.sliderCentre[axis] - sliderRadius);
        upper = Math.min(upper, selected.sliderCentre[axis] + sliderRadius);
      }
      const offset = (selected.light.position[axis] - start) * sign;
      input.min = String(Math.min((lower - start) * sign, (upper - start) * sign).toFixed(2));
      input.max = String(Math.max((lower - start) * sign, (upper - start) * sign).toFixed(2));
      input.value = String(offset);
      panel.querySelector(`[for="${input.id}"] output`).textContent = `${offset.toFixed(2)}${positionSuffix}`;
    }
    selected.positionByRoom.set(room.id, selected.light.position.clone());
    render();
  }

  function markLampFound() {
    selected.foundRooms.add(room);
    selected.marker.setAttribute('data-lamp-found', '');
  }

  function moveTo(destination, slide = 'free') {
    if (!room) return;
    markLampFound();
    if (!collision) {
      queuedMove = { room, lamp: selected, destination: destination.clone(), slide };
      if (!collisionPending) {
        moveNote.textContent = 'Preparing the cave boundaries…';
        collisionPending = loadCollision().then(mesh => {
          collisionPending = null;
          const request = queuedMove;
          queuedMove = null;
          if (request?.room !== room || request?.lamp !== selected) return;
          collision = mesh;
          moveNote.textContent = '';
          moveTo(request.destination, request.slide);
        }).catch(error => {
          collisionPending = null;
          queuedMove = null;
          moveNote.textContent = 'Could not load the cave boundaries. Try moving the lamp again.';
          console.error(error);
        });
      }
      return;
    }
    const previous = selected.light.position.clone();
    const bounded = destination.clone().clamp(collision.bounds.min, collision.bounds.max);
    const blocked = collision.move(previous, bounded, selected.light.position, slide);
    const message = blocked ? 'The lamp has reached a cave surface.' : '';
    if (moveNote.textContent !== message) moveNote.textContent = message;
    if (!previous.equals(selected.light.position)) selected.light.shadow.needsUpdate = true;
    syncPosition();
    if (!drag && !previous.equals(selected.light.position)) onMove(selected.light.position);
  }

  function jog(directions, distance) {
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    right.crossVectors(forward, up).normalize();
    motion.set(0, 0, 0);
    for (const direction of directions) {
      switch (direction) {
        case 'forward': motion.add(forward); break;
        case 'back': motion.sub(forward); break;
        case 'right': motion.add(right); break;
        case 'left': motion.sub(right); break;
        case 'up': motion.add(up); break;
        case 'down': motion.sub(up); break;
      }
    }
    if (motion.lengthSq()) {
      const slide = motion.y ? 'none' : 'horizontal';
      moveTo(motion.setLength(distance).add(selected.light.position), slide);
    }
  }

  function hold(id, direction) {
    if (!held.size) motionTime = performance.now();
    held.set(id, direction);
    render();
  }

  function updateLamp(lamp) {
    const sample = recordingSample(lamp) / lamp.traceScaleUv * lamp.strengthPercent / 100;
    lamp.sampleNormalized = sample;
    lamp.flameSample.value = Math.max(-2, Math.min(2, sample));
    const width = 1 + 0.24 * lamp.flameSample.value;
    lamp.flame.scale.set(width, 1 + 0.32 * lamp.flameSample.value, width).multiplyScalar(3);
    lamp.brightness.value = lamp.brightnessPercent / 100;
    const enabled = lamp.index < lampCount;
    lamp.light.intensity = enabled ? (room?.intensity ?? 3.3) * lamp.brightness.value : 0;
    const castShadow = shadowsEnabled && enabled && lamp.brightnessPercent > 0;
    if (castShadow !== lamp.light.castShadow) lamp.light.shadow.needsUpdate = true;
    lamp.light.castShadow = castShadow;
    lamp.body.visible = enabled;
    lamp.flame.visible = enabled && lamp.brightnessPercent > 0;
  }

  function syncLightSamples() {
    // WebGLLights sorts shadow-casting sources before other lights. Changing
    // a lamp's brightness to zero must retain each source's optical sample.
    const ordered = lamps.slice().sort((a, b) => Number(b.light.castShadow) - Number(a.light.castShadow));
    ordered.forEach((lamp, index) => { lampSamples.value[index] = lamp.sampleNormalized; });
  }

  function updateSampleReadout() {
    const sampleUv = recordingSample(selected);
    level.textContent = surveyView ? 'Survey colours' : selected.mode === 'steady'
      ? 'Steady' : `Signal ${voltageFormat.format(sampleUv / 1000)} mV`;
    time.value = String(selected.elapsed);
    timeReadout.textContent = selected.recording
      ? `${timeFormat.format(selected.elapsed)} / ${timeFormat.format(recordingDuration(selected))} s`
      : selected.recordingUnavailable ? 'Recordings unavailable' : 'Loading recordings…';
  }

  function refresh() {
    lamps.forEach(updateLamp);
    syncLightSamples();
    const active = visible && !surveyView;
    lights.visible = active;
    for (const { mesh, source, lit } of materials) mesh.material = active ? lit : source;
    survey.setAttribute('aria-pressed', String(surveyView));
    steady.setAttribute('aria-pressed', String(!surveyView && selected.mode === 'steady'));
    if (brightnessInput) {
      brightnessInput.value = String(selected.brightnessPercent);
      brightnessInput.disabled = surveyView;
      brightnessInput.setAttribute('aria-valuetext', `${selected.brightnessPercent}%`);
      brightnessReadout.textContent = `${selected.brightnessPercent}%`;
    }
    if (strengthInput) {
      strengthInput.value = String(selected.strengthPercent);
      strengthInput.disabled = surveyView || selected.mode !== 'recorded' || !selected.recording;
      strengthInput.setAttribute('aria-valuetext', `${selected.strengthPercent}%`);
      strengthReadout.textContent = `${selected.strengthPercent}%`;
    }
    const fire = selected.source === 'fire';
    picker.setAttribute('aria-label', fire ? 'Fire recording' : 'Lamp recording');
    const optionsMatch = picker.options.length === selected.traces.length &&
      selected.traces.every((trace, index) => picker.options[index].textContent === trace.label);
    if (!optionsMatch) picker.replaceChildren(...selected.traces.map((trace, index) => new Option(trace.label, String(index))));
    picker.value = String(selected.traceIndex);
    time.max = String(recordingDuration(selected));
    frequency.min = fire ? '0.25' : '0.5';
    frequency.max = fire ? '2' : '12';
    frequency.step = fire ? '0.05' : '0.1';
    frequencyLabel.textContent = fire ? 'Playback speed' : 'Dominant flicker rate';
    frequencyHelp.textContent = fire ? 'At 1×, the fire recording plays at its original speed.' : lampFrequencyHelp;
    fireHelp.hidden = !fire;
    play.textContent = selected.running ? 'Pause flicker' : 'Play recorded flicker';
    play.setAttribute('aria-pressed', String(!surveyView && selected.mode === 'recorded'));
    play.disabled = picker.disabled = time.disabled = frequency.disabled = recordedSpeed.disabled = !selected.recording;
    if (selected.recording) {
      const rate = selected.selectedFrequency ?? (fire ? 1 : selected.recording.nativePeakHz);
      frequency.value = String(rate);
      frequencyReadout.textContent = fire ? `${rate}×` : `${timeFormat.format(rate)} Hz`;
    } else frequencyReadout.textContent = '—';
    for (const lamp of lamps) {
      lamp.marker.toggleAttribute('data-selected', lamp === selected);
      lamp.marker.setAttribute('aria-pressed', String(lamp === selected));
    }
    updateSampleReadout();
    render();
  }

  function choose(next) {
    if (next === 'survey') {
      const now = performance.now();
      for (const lamp of lamps) {
        advanceRecording(lamp, now);
        lamp.running = false;
      }
      surveyView = true;
      refresh();
      return;
    }
    surveyView = false;
    advanceRecording(selected, performance.now());
    selected.running = false;
    selected.mode = next;
    refresh();
  }

  function stopDrag() {
    const wasDragging = Boolean(drag);
    drag = null;
    controls.enabled = true;
    if (wasDragging && room) onMove(selected.light.position);
  }

  function selectLamp(index) {
    if (!Number.isInteger(index) || index < 0 || index >= lampCount) return false;
    if (index === selectedIndex) return true;
    if (drag) stopDrag();
    held.clear();
    queuedMove = null;
    selectedIndex = index;
    selected = lamps[index];
    moveNote.textContent = '';
    syncPosition();
    refresh();
    notifySelection();
    if (room) onMove(selected.light.position);
    return true;
  }

  function initialPosition(lamp) {
    const start = room.start.clone();
    if (!lamp.index || !collision) return start;
    const offsets = [new Vector3(0.5, 0, 0), new Vector3(-0.5, 0, 0),
      new Vector3(0, 0, 0.5), new Vector3(0, 0, -0.5)];
    const offset = offsets[lamp.index - 1];
    for (const distance of [1, 0.6, 0.3]) {
      const destination = offset.clone().multiplyScalar(distance).add(start);
      if (!collision.bounds.containsPoint(destination)) continue;
      const accepted = start.clone();
      collision.move(start, destination, accepted, 'none');
      if (accepted.distanceToSquared(start) > 0.01 && collision.isClear(accepted)) return accepted;
    }
    return start;
  }

  function frame(now) {
    if (held.size && visible) {
      const delta = Math.max(0, Math.min((now - motionTime) / 1000, 0.07));
      motionTime = now;
      if (delta) jog(new Set(held.values()), delta * 1.8);
      render();
    }
    let wasRunning = false;
    let selectedEnded = false;
    for (const lamp of lamps.slice(0, lampCount)) {
      const running = lamp.running;
      if (advanceRecording(lamp, now)) {
        wasRunning = true;
        updateLamp(lamp);
        if (lamp === selected && running && !lamp.running) selectedEnded = true;
      }
    }
    if (wasRunning) {
      syncLightSamples();
      updateSampleReadout();
      render();
    }
    if (selectedEnded) refresh();
    for (const lamp of lamps) {
      const marker = lamp.marker;
      if (!visible || surveyView || lamp.index >= lampCount) {
        marker.hidden = true;
        continue;
      }
      projected.copy(lamp.light.position).project(camera);
      const dragging = drag && lamp === selected;
      marker.hidden = !dragging && (Math.abs(projected.x) > 0.985 || Math.abs(projected.y) > 0.985 || Math.abs(projected.z) > 1);
      if (marker.hidden) continue;
      marker.style.left = `${(projected.x + 1) * 50}%`;
      marker.style.top = `${(1 - projected.y) * 50}%`;
      const halfFov = camera.getEffectiveFOV() * Math.PI / 360;
      const diameter = stage.clientHeight * lampRadius /
        (Math.tan(halfFov) * camera.position.distanceTo(lamp.light.position));
      const hitSize = overview ? 44 : Math.max(44, Math.min(160, diameter));
      marker.style.setProperty('--lamp-hit-size', `${hitSize}px`);
    }
  }

  function planePoint(event) {
    const rect = stage.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    if (overview) planeNormal.set(0, 1, 0);
    else camera.getWorldDirection(planeNormal);
    plane.setFromNormalAndCoplanarPoint(planeNormal, drag?.origin ?? selected.light.position);
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(plane, hit);
  }

  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (!keys[key] || !visible || event.ctrlKey || event.metaKey || event.altKey ||
        (document.activeElement !== stage && document.activeElement !== selected.marker)) return;
    event.preventDefault();
    if (held.has(key)) return;
    jog([keys[key]], 0.12);
    hold(key, keys[key]);
  });
  window.addEventListener('keyup', event => held.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => held.clear());
  for (const button of jogButtons) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      button.setPointerCapture(event.pointerId);
      hold(event.pointerId, button.dataset.jog);
    });
    button.addEventListener('lostpointercapture', event => held.delete(event.pointerId));
    button.addEventListener('pointercancel', event => held.delete(event.pointerId));
    button.addEventListener('click', () => jog([button.dataset.jog], 0.20));
  }
  for (const lamp of lamps) {
    lamp.marker.addEventListener('click', () => selectLamp(lamp.index));
    lamp.marker.addEventListener('pointerdown', event => {
      if (!room || event.button !== 0 || drag) return;
      selectLamp(lamp.index);
      if (!planePoint(event)) return;
      event.preventDefault();
      lamp.marker.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, origin: selected.light.position.clone(), previousHit: hit.clone() };
      controls.enabled = false;
      markLampFound();
    });
    lamp.marker.addEventListener('pointermove', event => {
      if (drag?.pointerId !== event.pointerId || lamp !== selected || !planePoint(event)) return;
      const position = queuedMove?.lamp === selected && queuedMove.room === room
        ? queuedMove.destination : selected.light.position;
      moveTo(hit.clone().sub(drag.previousHit).add(position), overview ? 'horizontal' : 'free');
      drag.previousHit.copy(hit);
    });
    lamp.marker.addEventListener('lostpointercapture', stopDrag);
    lamp.marker.addEventListener('pointercancel', stopDrag);
  }
  for (const [index, input] of positionInputs.entries()) {
    input.addEventListener('input', () => {
      if (!room) return;
      const { axis, sign } = room.bounds[index];
      const next = selected.light.position.clone();
      next[axis] = room.start[axis] + sign * Number(input.value);
      moveTo(next, 'none');
    });
    input.addEventListener('change', () => {
      if (!room || !preciseMovement) return;
      const { axis } = room.bounds[index];
      selected.sliderCentre[axis] = selected.light.position[axis];
      syncPosition();
    });
  }
  reset.addEventListener('click', () => {
    queuedMove = null;
    if (room && (!collision || collision.isClear(room.start))) {
      selected.light.position.copy(room.start);
      selected.sliderCentre.copy(selected.light.position);
      selected.light.shadow.needsUpdate = true;
      selected.foundRooms.delete(room);
      selected.marker.removeAttribute('data-lamp-found');
    }
    moveNote.textContent = '';
    syncPosition();
    if (room) onMove(selected.light.position);
  });
  survey.addEventListener('click', () => choose('survey'));
  steady.addEventListener('click', () => choose('steady'));
  brightnessInput?.addEventListener('input', () => {
    selected.brightnessPercent = brightnessInput.valueAsNumber;
    refresh();
  });
  strengthInput?.addEventListener('input', () => {
    selected.strengthPercent = strengthInput.valueAsNumber;
    refresh();
  });
  play.addEventListener('click', () => {
    if (!selected.recording) return;
    if (selected.running) { choose('recorded'); return; }
    if (selected.elapsed >= recordingDuration(selected)) selected.elapsed = 0;
    surveyView = false;
    selected.mode = 'recorded';
    selected.running = true;
    selected.lastFrame = performance.now();
    refresh();
  });
  picker.addEventListener('change', () => {
    if (!selected.recording) return;
    selected.running = false;
    selectRecording(selected, Number(picker.value));
    selected.elapsed = 0;
    refresh();
  });
  time.addEventListener('input', () => {
    if (!selected.recording) return;
    selected.running = false;
    selected.elapsed = Number(time.value);
    surveyView = false;
    selected.mode = 'recorded';
    refresh();
  });
  function setFrequency(value) {
    advanceRecording(selected, performance.now());
    selected.selectedFrequency = value;
    refresh();
  }
  frequency.addEventListener('input', () => setFrequency(Number(frequency.value)));
  recordedSpeed.addEventListener('click', () => setFrequency(null));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const lamp of lamps) {
      advanceRecording(lamp, performance.now());
      lamp.running = false;
    }
    refresh();
  });
  refresh();

  return {
    setOnLampChange(callback) { onLampChange = callback; },
    setLampCount(count) {
      if (!Number.isInteger(count) || count < 1 || count > MAX_LAMPS) return false;
      if (count === lampCount) return true;
      if (drag) stopDrag();
      held.clear();
      queuedMove = null;
      const now = performance.now();
      for (const lamp of lamps.slice(count)) {
        advanceRecording(lamp, now);
        lamp.running = false;
      }
      lampCount = count;
      for (const lamp of lamps.slice(0, count)) {
        const cached = recordingCache.get(lamp.source);
        if (!lamp.recording && cached) installRecordings(lamp, cached.recordings, cached.scaleUv);
        if (room && !lamp.positionByRoom.has(room.id)) {
          lamp.light.position.copy(initialPosition(lamp));
          lamp.positionByRoom.set(room.id, lamp.light.position.clone());
          lamp.sliderCentre.copy(lamp.light.position);
        }
      }
      selectedIndex = Math.min(selectedIndex, count - 1);
      selected = lamps[selectedIndex];
      invalidateShadows();
      syncPosition();
      refresh();
      notifySelection();
      return true;
    },
    selectLamp,
    getLampStates: states,
    getSelectedLampIndex() { return selectedIndex; },
    setShadowsEnabled(enabled) {
      shadowsEnabled = Boolean(enabled);
      invalidateShadows();
      refresh();
    },
    playAll() {
      surveyView = false;
      const now = performance.now();
      for (const lamp of lamps.slice(0, lampCount)) {
        if (!lamp.recording) continue;
        advanceRecording(lamp, now);
        if (lamp.elapsed >= recordingDuration(lamp)) lamp.elapsed = 0;
        lamp.mode = 'recorded';
        lamp.running = true;
        lamp.lastFrame = now;
      }
      refresh();
    },
    pauseAll() {
      const now = performance.now();
      for (const lamp of lamps) {
        advanceRecording(lamp, now);
        lamp.running = false;
      }
      refresh();
    },
    restartAll() {
      for (const lamp of lamps.slice(0, lampCount)) {
        lamp.running = false;
        lamp.elapsed = 0;
      }
      this.playAll();
    },
    prepareRecordings(source, lampIndex = selectedIndex) {
      const lamp = lamps[lampIndex];
      if (!lamp || !['lamp', 'fire'].includes(source)) return false;
      if (lamp.source !== source) {
        advanceRecording(lamp, performance.now());
        lamp.source = source;
        lamp.running = false;
        lamp.traces = [];
        lamp.recording = null;
        lamp.recordingUnavailable = false;
        lamp.selectedFrequency = null;
        lamp.elapsed = 0;
        lamp.traceIndex = lamp.index;
        if (lamp.mode === 'recorded') lamp.mode = 'steady';
      }
      const cached = recordingCache.get(source);
      if (!lamp.recording && cached) installRecordings(lamp, cached.recordings, cached.scaleUv);
      refresh();
      return true;
    },
    setTraces(recordings, scaleUv, lampIndex = selectedIndex, source = lamps[lampIndex]?.source) {
      const lamp = lamps[lampIndex];
      if (!lamp || lamp.source !== source) return false;
      installRecordings(lamp, recordings, scaleUv);
      recordingCache.set(source, { recordings, scaleUv });
      for (const other of lamps) {
        if (other.source === source && !other.recording) installRecordings(other, recordings, scaleUv);
      }
      refresh();
      return true;
    },
    setRecordingUnavailable(lampIndex = selectedIndex, source = lamps[lampIndex]?.source) {
      const lamp = lamps[lampIndex];
      if (!lamp || lamp.source !== source || lamp.recording) return;
      lamp.recordingUnavailable = true;
      lamp.running = false;
      refresh();
    },
    setCollision(mesh) { collision = mesh; syncPosition(); },
    position() { return room ? selected.light.position.clone() : null; },
    relocate(destination) {
      if (!room || !collision?.bounds.containsPoint(destination) || !collision.isClear(destination)) return false;
      if (drag) stopDrag();
      held.clear();
      queuedMove = null;
      selected.light.position.copy(destination);
      selected.sliderCentre.copy(destination);
      selected.light.shadow.needsUpdate = true;
      markLampFound();
      moveNote.textContent = '';
      if (surveyView) choose('steady');
      syncPosition();
      onMove(selected.light.position);
      return true;
    },
    applyComparison(destination, { brightness: percent, strength }, alternating) {
      if (!this.relocate(destination)) return false;
      if (alternating && selected.mode !== 'steady') choose('steady');
      selected.brightnessPercent = percent;
      if (strength != null) selected.strengthPercent = strength;
      refresh();
      return true;
    },
    attach(object) {
      object.traverse(mesh => {
        // Imported viewer lights belong to the scan's presentation. Relighting
        // uses the independent experimental sources defined by this controller.
        if (mesh.isLight) mesh.visible = false;
        if (!mesh.isMesh) return;
        mesh.castShadow = mesh.receiveShadow = true;
        const source = mesh.material;
        const makeLit = material => {
          const lit = new MeshLambertMaterial({ map: material.map, color: material.color, side: material.side });
          applyLampLighting(lit, lampSamples);
          return lit;
        };
        const lit = Array.isArray(source) ? source.map(makeLit) : makeLit(source);
        materials.push({ mesh, source, lit });
      });
      invalidateShadows();
    },
    show(nextRoom, { fromAbove = false, usePrecisionSliders = false } = {}) {
      if (room !== nextRoom || overview !== fromAbove) {
        const now = performance.now();
        for (const lamp of lamps) {
          advanceRecording(lamp, now);
          lamp.running = false;
        }
        if (drag) stopDrag();
        held.clear();
        queuedMove = null;
      }
      room = nextRoom;
      overview = fromAbove;
      preciseMovement = usePrecisionSliders;
      visible = Boolean(room);
      panel.hidden = !visible;
      if (navigation) navigation.hidden = !visible;
      ambient.intensity = overview ? 0.33 : 0.025;
      for (const lamp of lamps) {
        lamp.marker.toggleAttribute('data-overview', overview);
        lamp.marker.toggleAttribute('data-lamp-found', room && lamp.foundRooms.has(room));
        if (!room) continue;
        lamp.light.position.copy(lamp.positionByRoom.get(room.id) ?? initialPosition(lamp));
        lamp.sliderCentre.copy(lamp.light.position);
        if (lamp.index < lampCount) lamp.positionByRoom.set(room.id, lamp.light.position.clone());
      }
      invalidateShadows();
      moveNote.textContent = '';
      syncPosition();
      refresh();
    },
    frame
  };
}
