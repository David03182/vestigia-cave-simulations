export function createLampComparison({ stage, loadCollision, apply, focus }) {
  const panel = document.querySelector('#lamp-comparison');
  const buttons = [...panel.querySelectorAll('[data-lamp-position]')];
  const play = panel.querySelector('#alternate-lamp');
  const speed = panel.querySelector('#alternation-rate');
  const rate = panel.querySelector('#alternation-rate-value');
  const status = panel.querySelector('#comparison-status');
  let pair;
  let phase = -1;
  let pending = false;
  let generation = 0;
  let frame = null;
  let start = 0;

  function stop() {
    generation++;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending = false;
    play.textContent = 'Play alternation';
    panel.removeAttribute('aria-busy');
    status.textContent = '';
  }

  function applyPhase(index, alternating) {
    if (!apply(pair.states[index], alternating)) return false;
    phase = index;
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    return true;
  }

  function fail() {
    stop();
    status.textContent = 'Lamp positions unavailable. Try again.';
  }

  function tick(now) {
    if (now - start >= 500 / speed.valueAsNumber) {
      if (!applyPhase(1 - phase, true)) { fail(); return; }
      start = now;
    }
    frame = requestAnimationFrame(tick);
  }

  async function select(index, autoplay = false) {
    if (!pair || pending) return;
    stop();
    const request = generation;
    pending = true;
    panel.setAttribute('aria-busy', 'true');
    status.textContent = 'Preparing lamp positions…';
    try {
      await loadCollision();
      if (generation !== request) return;
      if (!applyPhase(index, autoplay)) { fail(); return; }
      focus(pair);
      stop();
      if (autoplay) {
        start = performance.now();
        play.textContent = 'Pause alternation';
        frame = requestAnimationFrame(tick);
      }
    } catch {
      if (generation === request) fail();
    }
  }

  function clearSelection() {
    stop();
    phase = -1;
    for (const button of buttons) button.setAttribute('aria-pressed', 'false');
  }

  buttons.forEach((button, i) => button.addEventListener('click', () => select(i)));
  play.addEventListener('click', () => {
    if (frame !== null) stop();
    else select(Math.max(phase, 0), true);
  });
  speed.addEventListener('input', () => {
    rate.textContent = `${speed.value} Hz`;
    speed.setAttribute('aria-valuetext', `${speed.value} cycles per second`);
  });

  // Give manual lamp, camera and recording controls priority.
  stage.addEventListener('pointerdown', event => {
    if (!event.target.closest('#toggle-fullscreen')) clearSelection();
  }, { capture: true });
  stage.addEventListener('keydown', event => {
    if (/^[wasdqe]$/i.test(event.key)) clearSelection();
  }, { capture: true });
  const manual = '[data-recording-source], #survey-light, #steady-light, #play-light, #lamp-brightness, #lamp-flicker-strength, #lamp-time, #lamp-frequency, #recorded-speed, #lamp-recording, #place-lamp, #follow-lamp, #bring-lamp-here, [data-position], #reset-lamp, #reset, [data-jog]';
  for (const event of ['click', 'input', 'change', 'pointerdown']) {
    document.addEventListener(event, e => {
      if (pair && (pending || phase !== -1) && e.target.closest(manual)) clearSelection();
    }, { capture: true });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && frame !== null) stop();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (frame !== null || pending)) stop();
  });

  return {
    show(next) {
      clearSelection();
      pair = next;
      panel.hidden = !pair;
    }
  };
}
