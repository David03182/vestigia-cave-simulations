export function createMultiLampUI(caveLight, recordings) {
  const count = document.querySelector('#lamp-count');
  const tabs = document.querySelector('#lamp-selectors');
  const heading = document.querySelector('#selected-lamp-heading');
  const shadows = document.querySelector('#lamp-shadows');

  function sync(snapshot) {
    const restoreTabFocus = tabs.contains(document.activeElement);
    count.value = String(snapshot.count);
    heading.textContent = `Lamp ${snapshot.index + 1} controls`;
    tabs.replaceChildren(...Array.from({ length: snapshot.count }, (_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `select-lamp-${index + 1}`;
      button.dataset.selectLamp = String(index);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'shaft-controls');
      button.setAttribute('aria-selected', String(index === snapshot.index));
      button.tabIndex = index === snapshot.index ? 0 : -1;
      button.textContent = `Lamp ${index + 1}`;
      return button;
    }));
    document.querySelector('#shaft-controls').setAttribute('aria-labelledby', `select-lamp-${snapshot.index + 1}`);
    if (restoreTabFocus) tabs.querySelector('[aria-selected="true"]').focus();
    recordings.sync(snapshot);
  }

  count.addEventListener('change', () => caveLight.setLampCount(count.valueAsNumber || Number(count.value)));
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-select-lamp]');
    if (button) caveLight.selectLamp(Number(button.dataset.selectLamp));
  });
  tabs.addEventListener('keydown', event => {
    const selected = caveLight.getSelectedLampIndex();
    const total = Number(count.value);
    let index;
    if (event.key === 'ArrowRight') index = (selected + 1) % total;
    else if (event.key === 'ArrowLeft') index = (selected + total - 1) % total;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = total - 1;
    else return;
    event.preventDefault();
    caveLight.selectLamp(index);
    tabs.querySelector(`[data-select-lamp="${index}"]`).focus();
  });
  document.querySelector('#play-all-lamps').addEventListener('click', () => caveLight.playAll());
  document.querySelector('#pause-all-lamps').addEventListener('click', () => caveLight.pauseAll());
  document.querySelector('#restart-all-lamps').addEventListener('click', () => caveLight.restartAll());
  shadows.addEventListener('change', () => caveLight.setShadowsEnabled(shadows.checked));
  caveLight.setOnLampChange(sync);
  sync({
    index: caveLight.getSelectedLampIndex(), count: Number(count.value),
    source: 'lamp', lamps: caveLight.getLampStates()
  });
}
