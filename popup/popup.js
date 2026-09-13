const viewLogin = document.getElementById("view-login");
const viewMain = document.getElementById("view-main");
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginNote = document.getElementById("login-note");
const btnLogin = document.getElementById("btn-login");
const statusBadge = document.getElementById("status-badge");
const deviceSelect = document.getElementById("device");
const mainNote = document.getElementById("main-note");
const btnSendTab = document.getElementById("btn-send-tab");
const btnSendOptions = document.getElementById("btn-send-options");
const userEmail = document.getElementById("user-email");
const btnOptions = document.getElementById("btn-options");
const btnLogout = document.getElementById("btn-logout");
const overviewBox = document.getElementById("overview");
const speedEl = document.getElementById("speed");
const countsEl = document.getElementById("counts");
const packagesList = document.getElementById("packages");
const btnToggle = document.getElementById("btn-toggle");
const btnStop = document.getElementById("btn-stop");
const btnConfirm = document.getElementById("btn-confirm");
const btnStatus = document.getElementById("btn-status");
const btnContainer = document.getElementById("btn-container");

// --- the glance at the device -------------------------------------------------

/** How often the popup asks while it is open; nothing asks once it closes. */
const GLANCE_EVERY = 2000;
/** Packages shown; the rest is a count. */
const SHOWN = 4;
let glanceTimer = null;
let glancing = false;
let lastState = "UNKNOWN";

function bytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function duration(seconds) {
  if (seconds < 0) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function renderPackage(p) {
  const li = document.createElement("li");
  li.className = `package${p.running ? " running" : ""}${p.finished ? " done" : ""}${p.enabled || p.finished ? "" : " disabled"}`;
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = p.name;
  name.title = p.name;
  const detail = document.createElement("span");
  detail.className = "detail";
  const pct = p.bytesTotal > 0 ? Math.floor((p.bytesLoaded / p.bytesTotal) * 100) : 0;
  if (p.running) {
    detail.textContent = [`${pct}%`, p.speed > 0 ? `${bytes(p.speed)}/s` : "", duration(p.eta)].filter(Boolean).join(" · ");
  } else if (p.finished) {
    const outcome = { extracting: "extracting", queued: "extract queued", extracted: "extracted", failed: "extraction failed" }[p.extraction];
    detail.textContent = `${outcome ?? "done"} · ${bytes(p.bytesTotal)}`;
    if (p.extraction === "failed") li.classList.add("failed");
  } else if (!p.enabled) {
    detail.textContent = "disabled";
  } else {
    detail.textContent = p.bytesTotal > 0 ? `${pct}% · waiting` : "waiting";
  }
  const bar = document.createElement("span");
  bar.className = "bar";
  const fill = document.createElement("span");
  fill.style.width = `${pct}%`;
  bar.append(fill);
  li.append(name, detail, bar);
  return li;
}

function renderOverview(o) {
  lastState = o.state;
  const running = o.packages.filter((p) => p.running).length;
  const finished = o.packages.filter((p) => p.finished).length;
  const waiting = o.packages.length - running - finished;
  speedEl.textContent =
    o.state === "RUNNING" || running > 0
      ? `↓ ${bytes(o.speed)}/s`
      : o.state === "PAUSE"
        ? "Paused"
        : o.packages.length === 0
          ? "Empty"
          : waiting === 0
            ? "All done"
            : "Idle";
  const parts = [];
  if (running) parts.push(`${running} running`);
  if (waiting) parts.push(`${waiting} waiting`);
  if (finished) parts.push(`${finished} done`);
  const extracting = o.packages.filter((p) => p.extraction === "extracting" || p.extraction === "queued").length;
  if (extracting) parts.push(`${extracting} extracting`);
  if (o.bytesTotal > 0) parts.push(waiting || running ? `${bytes(o.bytesLoaded)} of ${bytes(o.bytesTotal)}` : bytes(o.bytesTotal));
  if (o.grabber.links) parts.push(`${o.grabber.links} in LinkGrabber`);
  else if (o.grabber.collecting) parts.push("LinkGrabber busy");
  countsEl.textContent = parts.join(" · ") || "Nothing in the download list";

  packagesList.replaceChildren(...o.packages.slice(0, SHOWN).map(renderPackage));
  if (o.packages.length > SHOWN) {
    const more = document.createElement("li");
    more.className = "muted";
    more.textContent = `and ${o.packages.length - SHOWN} more in the list`;
    packagesList.append(more);
  }

  btnToggle.disabled = false;
  btnToggle.textContent = o.state === "RUNNING" ? "Pause" : o.state === "PAUSE" ? "Resume" : "Start";
  btnToggle.dataset.action = o.state === "RUNNING" ? "pause" : o.state === "PAUSE" ? "resume" : "start";
  btnStop.disabled = !(o.state === "RUNNING" || o.state === "PAUSE");
  btnConfirm.hidden = o.grabber.links === 0;
  btnConfirm.textContent = `Confirm ${o.grabber.links} in LinkGrabber`;
}

async function glance() {
  if (glancing || !deviceSelect.value) return;
  glancing = true;
  try {
    renderOverview(await ask("overview", { device: deviceSelect.value }));
    hideNote(mainNote);
  } catch (e) {
    closeStatus();
    showNote(mainNote, e.message);
  } finally {
    glancing = false;
  }
}

function startGlancing() {
  stopGlancing();
  glance();
  glanceTimer = setInterval(glance, GLANCE_EVERY);
}

function stopGlancing() {
  clearInterval(glanceTimer);
  glanceTimer = null;
}

// The status box is closed when the popup opens, so the popup appears in
// its final shape at once; asking the device starts only when someone
// wants to see it.
function openStatus() {
  speedEl.textContent = "—";
  countsEl.textContent = "Asking…";
  packagesList.replaceChildren();
  btnToggle.disabled = btnStop.disabled = true;
  btnConfirm.hidden = true;
  overviewBox.hidden = false;
  btnStatus.setAttribute("aria-expanded", "true");
  startGlancing();
}

function closeStatus() {
  stopGlancing();
  overviewBox.hidden = true;
  btnStatus.setAttribute("aria-expanded", "false");
}

btnStatus.addEventListener("click", () => (overviewBox.hidden ? openStatus() : closeStatus()));

async function act(button, action) {
  button.disabled = true;
  try {
    await ask("control", { device: deviceSelect.value, action });
    await glance();
  } catch (e) {
    showNote(mainNote, e.message);
  } finally {
    button.disabled = false;
  }
}

btnToggle.addEventListener("click", () => act(btnToggle, btnToggle.dataset.action ?? "start"));
btnStop.addEventListener("click", () => act(btnStop, "stop"));
btnConfirm.addEventListener("click", () => act(btnConfirm, "confirm"));
window.addEventListener("unload", stopGlancing);

function show(view) {
  viewLogin.hidden = view !== "login";
  viewMain.hidden = view !== "main";
}

function setOnline(online, label) {
  statusBadge.textContent = label ?? (online ? "Online" : "Offline");
  statusBadge.className = `badge ${online ? "badge--online" : "badge--offline"}`;
}

async function init() {
  const status = await ask("status");
  if (!status.loggedIn) {
    show("login");
    emailInput.focus();
    return;
  }
  userEmail.textContent = status.email ?? "";
  show("main");
  await refreshDevices();
}

async function refreshDevices() {
  hideNote(mainNote);
  setOnline(false, "…");
  try {
    const settings = await loadSettings();
    const devices = await fillDevices(deviceSelect, settings.device);
    const mine = devices.find((d) => d.id === deviceSelect.value);
    setOnline(!!mine, mine ? "Connected" : "No device");
    btnSendTab.disabled = btnSendOptions.disabled = btnContainer.disabled = btnStatus.disabled = !mine;
    // The first device becomes the default when none was chosen yet.
    if (!settings.device && mine) await saveSettings({ device: mine.id });
    if (!mine) closeStatus();
  } catch (e) {
    setOnline(false);
    showNote(mainNote, e.message);
    btnSendTab.disabled = btnSendOptions.disabled = btnContainer.disabled = btnStatus.disabled = true;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideNote(loginNote);
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showNote(loginNote, "Both the e-mail and the password are needed.");
    return;
  }
  btnLogin.disabled = true;
  btnLogin.textContent = "Signing in…";
  try {
    // Firefox treats host permissions as optional until asked; Chrome
    // already granted this at install and answers without a prompt.
    if (ext.permissions?.request) {
      const granted = await ext.permissions.request({ origins: ["https://api.jdownloader.org/*"] });
      if (!granted) throw new Error("jdsend needs to reach api.jdownloader.org.");
      // For Click'n'Load the content script has to run on the sites; Firefox
      // grants that only when asked. Not a condition for signing in.
      await ext.permissions.request({ origins: ["http://*/*", "https://*/*"] }).catch(() => false);
    }
    const status = await ask("login", { email, password });
    passwordInput.value = "";
    userEmail.textContent = status.email ?? email;
    show("main");
    await refreshDevices();
  } catch (e) {
    showNote(loginNote, e.message);
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = "Sign in";
  }
});

deviceSelect.addEventListener("change", () => {
  saveSettings({ device: deviceSelect.value });
  if (!overviewBox.hidden) openStatus();
});

async function sendTab(withOptions) {
  hideNote(mainNote);
  const tab = await currentTab();
  if (!tab) {
    showNote(mainNote, "This tab has no address to send.");
    return;
  }
  if (withOptions) {
    await ask("dialog", { text: tab.url, tab: { url: tab.url } });
    window.close();
    return;
  }
  btnSendTab.disabled = true;
  btnSendTab.textContent = "Sending…";
  try {
    const settings = await loadSettings();
    await ask("send", { device: deviceSelect.value, text: tab.url, options: { ...settings, sourceUrl: tab.url } });
    showNote(mainNote, "Sent to JDownloader.", "success");
    setTimeout(() => window.close(), 900);
  } catch (e) {
    showNote(mainNote, e.message);
  } finally {
    btnSendTab.disabled = false;
    btnSendTab.textContent = "Send this tab";
  }
}

btnSendTab.addEventListener("click", () => sendTab(false));
btnSendOptions.addEventListener("click", () => sendTab(true));
btnContainer.addEventListener("click", async () => {
  await ask("dialog", { text: "", container: true });
  window.close();
});
btnOptions.addEventListener("click", () => ext.runtime.openOptionsPage());
btnLogout.addEventListener("click", async () => {
  closeStatus();
  await ask("logout");
  emailInput.value = "";
  show("login");
});

init();
