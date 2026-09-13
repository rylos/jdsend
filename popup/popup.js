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
    btnSendTab.disabled = btnSendOptions.disabled = !mine;
    // The first device becomes the default when none was chosen yet.
    if (!settings.device && mine) await saveSettings({ device: mine.id });
  } catch (e) {
    setOnline(false);
    showNote(mainNote, e.message);
    btnSendTab.disabled = btnSendOptions.disabled = true;
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

deviceSelect.addEventListener("change", () => saveSettings({ device: deviceSelect.value }));

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
btnOptions.addEventListener("click", () => ext.runtime.openOptionsPage());
btnLogout.addEventListener("click", async () => {
  await ask("logout");
  emailInput.value = "";
  show("login");
});

init();
