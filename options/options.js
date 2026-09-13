const deviceSelect = document.getElementById("device");
const prioritySelect = document.getElementById("priority");
const folderInput = document.getElementById("folder");
const autostartInput = document.getElementById("autostart");
const note = document.getElementById("note");

async function init() {
  const settings = await loadSettings();
  prioritySelect.value = settings.priority;
  folderInput.value = settings.folder;
  autostartInput.checked = settings.autostart;

  const status = await ask("status");
  if (!status.loggedIn) {
    fillSelect(deviceSelect, [{ value: "", label: "Sign in from the toolbar first", disabled: true }]);
    return;
  }
  try {
    const devices = await fillDevices(deviceSelect, settings.device);
    if (settings.device && !devices.some((d) => d.id === settings.device)) {
      showNote(note, "The device chosen before is no longer on this account.", "muted");
    }
  } catch (e) {
    showNote(note, e.message);
  }
}

deviceSelect.addEventListener("change", () => saveSettings({ device: deviceSelect.value }));
prioritySelect.addEventListener("change", () => saveSettings({ priority: prioritySelect.value }));
folderInput.addEventListener("change", () => saveSettings({ folder: folderInput.value.trim() }));
autostartInput.addEventListener("change", () => saveSettings({ autostart: autostartInput.checked }));

init();
