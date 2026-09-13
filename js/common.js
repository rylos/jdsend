// Shared by the popup, the dialog and the options page.

const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULT_SETTINGS = { device: "", deviceName: "", autostart: true, priority: "DEFAULT", folder: "", rememberStatus: false, statusOpen: false };

async function loadSettings() {
  const { settings } = await ext.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function saveSettings(patch) {
  const settings = { ...(await loadSettings()), ...patch };
  await ext.storage.local.set({ settings });
  return settings;
}

/** Ask the background page; throws with a readable message when it says no. */
async function ask(type, fields = {}) {
  const reply = await ext.runtime.sendMessage({ type, ...fields });
  if (!reply) throw new Error("No answer from the extension.");
  if (!reply.ok) {
    const e = new Error(reply.error);
    e.kind = reply.kind;
    throw e;
  }
  return reply.value;
}

/** Replace a select's options; text goes through the DOM, never through HTML. */
function fillSelect(select, items, chosen) {
  select.replaceChildren();
  for (const { value, label, disabled } of items) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.disabled = !!disabled;
    select.append(option);
  }
  if (chosen !== undefined && items.some((i) => i.value === chosen)) select.value = chosen;
}

/** Fill a select with the account's devices and pick `chosen` when it is still there. */
async function fillDevices(select, chosen) {
  fillSelect(select, [{ value: "", label: "Loading…", disabled: true }]);
  const devices = await ask("devices");
  if (devices.length === 0) {
    fillSelect(select, [{ value: "", label: "No JDownloader is connected to this account", disabled: true }]);
    return devices;
  }
  fillSelect(
    select,
    devices.map((d) => ({ value: d.id, label: d.name })),
    chosen || devices[0].id,
  );
  return devices;
}

function showNote(el, message, kind = "error") {
  el.textContent = message;
  el.className = `note note--${kind}`;
  el.hidden = false;
}

function hideNote(el) {
  el.hidden = true;
  el.textContent = "";
}

/** The active tab, when the browser lets us see its address. */
async function currentTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab?.url ? tab : null;
}
