export function createRecordingTabs(caveLight, runtimePath) {
  const tabs = [...document.querySelectorAll('[data-recording-source]')];
  const panel = document.querySelector('#flicker-controls');
  const requests = new Map();
  const pendingTargets = new Map();

  function updateTabs(source) {
    const selected = tabs.find(tab => tab.dataset.recordingSource === source) ?? tabs[0];
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', String(tab === selected));
      tab.tabIndex = tab === selected ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', selected.id);
  }

  async function load(source, index) {
    const key = `${index}:${source}`;
    if (pendingTargets.has(key)) return pendingTargets.get(key);
    if (!requests.has(source)) {
      const request = fetch(`${runtimePath}pilot-${source}-waveforms.json`).then(response => {
        if (!response.ok) throw new Error(`Recording request returned ${response.status}`);
        return response.json();
      });
      requests.set(source, request);
    }
    const request = requests.get(source);
    const install = (async () => {
      try {
        const { recordings, previewScaleUv } = await request;
        caveLight.setTraces(recordings, previewScaleUv, index, source);
      } catch (error) {
        if (requests.get(source) === request) requests.delete(source);
        caveLight.setRecordingUnavailable(index, source);
        console.error(error);
      } finally {
        pendingTargets.delete(key);
      }
    })();
    pendingTargets.set(key, install);
    return install;
  }

  function sync(snapshot) {
    const state = snapshot.lamps[snapshot.index];
    const source = state?.source ?? snapshot.source ?? 'lamp';
    updateTabs(source);
    if (!state?.recordingReady) void load(source, snapshot.index);
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const source = tab.dataset.recordingSource;
      const index = caveLight.getSelectedLampIndex();
      caveLight.prepareRecordings(source, index);
      updateTabs(source);
      void load(source, index);
    });
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = tabs[1 - index];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs.at(-1);
      else return;
      event.preventDefault();
      next.focus();
      next.click();
    });
  }
  const loadActive = () => sync({
    index: caveLight.getSelectedLampIndex(), lamps: caveLight.getLampStates()
  });
  loadActive.sync = sync;
  return loadActive;
}
