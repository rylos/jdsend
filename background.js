// The part of jdsend that talks to My.JDownloader: a service worker in
// Chrome, an event page in Firefox. Everything visible (popup, dialog,
// options) asks it through runtime messages.

if (typeof importScripts === "function") importScripts("js/myjd.js");

const ext = globalThis.browser ?? globalThis.chrome;
const client = new myjd.Client(myjd.storageStore(ext.storage.local));

const DEFAULT_SETTINGS = { device: "", autostart: true, priority: "DEFAULT", folder: "" };

async function loadSettings() {
  const { settings } = await ext.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

// --- context menu ------------------------------------------------------------

const MENU_QUICK = "jdsend-quick";
const MENU_DIALOG = "jdsend-dialog";
const CONTEXTS = ["link", "image", "video", "audio", "selection", "page"];

async function installMenus() {
  await ext.contextMenus.removeAll();
  ext.contextMenus.create({ id: MENU_QUICK, title: "Send to JDownloader", contexts: CONTEXTS });
  ext.contextMenus.create({ id: MENU_DIALOG, title: "Send to JDownloader…", contexts: CONTEXTS });
}

ext.runtime.onInstalled.addListener(installMenus);
ext.runtime.onStartup.addListener(installMenus);

/** The most specific thing under the pointer: a link, then media, then selected text, then the page. */
function whatWasClicked(info) {
  return info.linkUrl || info.srcUrl || info.selectionText || info.pageUrl || "";
}

ext.contextMenus.onClicked.addListener((info, tab) => {
  const text = whatWasClicked(info);
  if (info.menuItemId === MENU_DIALOG) openDialog(text, tab);
  else if (info.menuItemId === MENU_QUICK) quickSend(text, tab);
});

ext.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "send-tab") return;
  tab ??= (await ext.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.url) quickSend(tab.url, tab);
});

// --- sending -----------------------------------------------------------------

/**
 * The LinkCollectingJob for `text`. JDownloader finds the links in whatever
 * text it is given, so a selection goes as it is.
 */
function jobFor(text, o = {}) {
  const job = { links: text, autostart: !!o.autostart };
  if (o.packageName) job.packageName = o.packageName;
  if (o.folder) job.destinationFolder = o.folder;
  if (o.priority && o.priority !== "DEFAULT") job.priority = o.priority;
  if (o.comment) job.comment = o.comment;
  if (o.downloadPassword) job.downloadPassword = o.downloadPassword;
  if (o.extractPassword) job.extractPassword = o.extractPassword;
  if (o.sourceUrl) job.sourceUrl = o.sourceUrl;
  // A name or folder chosen here beats the packagizer's rules; otherwise the rules apply.
  job.overwritePackagizerRules = !!(o.packageName || o.folder);
  return job;
}

function send(device, text, options) {
  if (!device) throw new Error("No device chosen.");
  if (!text?.trim()) throw new Error("Nothing to send.");
  return client.addLinks(device, jobFor(text.trim(), options));
}

/** Straight to the default device, with the outcome on the toolbar icon. */
async function quickSend(text, tab) {
  const settings = await loadSettings();
  if (!settings.device) return openDialog(text, tab);
  try {
    await send(settings.device, text, { ...settings, sourceUrl: tab?.url });
    flash("✓", "#16a34a", "Sent to JDownloader");
  } catch (e) {
    flash("!", "#dc2626", `jdsend: ${myjd.explain(e)}`);
  }
}

function openDialog(text, tab) {
  const query = new URLSearchParams({ text, source: tab?.url ?? "" });
  return ext.windows.create({
    url: `${ext.runtime.getURL("dialog/dialog.html")}?${query}`,
    type: "popup",
    width: 520,
    height: 680,
  });
}

let flashTimer = null;

/** A badge on the toolbar icon for a few seconds, with the detail in its tooltip. */
function flash(badge, color, title) {
  ext.action.setBadgeText({ text: badge });
  ext.action.setBadgeBackgroundColor({ color });
  ext.action.setTitle({ title });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    ext.action.setBadgeText({ text: "" });
    ext.action.setTitle({ title: "jdsend" });
  }, 4000);
}

// --- messages from the pages ---------------------------------------------------

async function handle(msg) {
  switch (msg.type) {
    case "status":
      return client.status();
    case "login":
      await client.login(msg.email, msg.password);
      return client.status();
    case "logout":
      return client.logout();
    case "devices":
      return (await client.listDevices()).map(({ id, name, status }) => ({ id, name, status }));
    case "folders":
      return client.folderHistory(msg.device);
    case "send":
      return send(msg.device, msg.text, msg.options);
    case "dialog":
      return openDialog(msg.text, msg.tab);
    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}

ext.runtime.onMessage.addListener((msg, _sender, respond) => {
  handle(msg).then(
    (value) => respond({ ok: true, value }),
    (e) => respond({ ok: false, error: myjd.explain(e), kind: e?.kind ?? "ERROR" }),
  );
  // The reply comes later.
  return true;
});
