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

let installing = null;

// The browser shows both under one "jdsend" entry, so the titles say what
// differs: nothing to fill in, or a form.
function installMenus() {
  // onInstalled and onStartup can both fire at once; two interleaved
  // removeAll/create sequences would trip over each other's ids.
  installing ??= (async () => {
    try {
      await ext.contextMenus.removeAll();
      ext.contextMenus.create({ id: MENU_QUICK, title: "Send to JDownloader now", contexts: CONTEXTS });
      ext.contextMenus.create({ id: MENU_DIALOG, title: "Send with options…", contexts: CONTEXTS });
    } finally {
      installing = null;
    }
  })();
  return installing;
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

const CONTAINER_KINDS = ["dlc", "ccf", "rsdf"];

/**
 * Hand JDownloader a container file whole. `content` is a data URL; the
 * kind is the container's own extension, which is what JDownloader saves
 * it under before opening it. The LinkGrabber decides the rest, as it does
 * for a container dropped on JDownloader itself.
 */
function sendContainer(device, kind, content) {
  if (!device) throw new Error("No device chosen.");
  if (!CONTAINER_KINDS.includes(kind)) throw new Error("Only .dlc, .ccf and .rsdf containers can be sent.");
  if (typeof content !== "string" || !content.startsWith("data:")) throw new Error("The container could not be read.");
  return client.call(() => client.deviceCall(device, "/linkgrabberv2/addContainer", [kind, content]));
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

function openDialog(text, tab, { container = false } = {}) {
  const query = new URLSearchParams({ text, source: tab?.url ?? "", ...(container ? { container: "1" } : {}) });
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

// --- a glance at the device ----------------------------------------------------

const PACKAGE_FIELDS = {
  bytesLoaded: true,
  bytesTotal: true,
  enabled: true,
  eta: true,
  finished: true,
  running: true,
  speed: true,
  status: true,
  childCount: true,
  maxResults: -1,
  startAt: 0,
};

/**
 * What became of each package's archives, by package id: "extracting",
 * "queued", "extracted" or "failed", and nothing for a package with no
 * archive in it. The queue knows what is being worked on now; the links'
 * `extractionStatus` is the outcome of a run that already ended.
 */
function extractionByPackage(packages, links, queue) {
  const byPackage = new Map();
  for (const link of links) {
    if (!byPackage.has(link.packageUUID)) byPackage.set(link.packageUUID, []);
    byPackage.get(link.packageUUID).push(link);
  }
  const result = new Map();
  for (const p of packages) {
    const mine = byPackage.get(p.uuid) ?? [];
    // An archive in the queue lists its volumes by link name.
    const archive = queue.find((a) => a.states && mine.some((l) => Object.hasOwn(a.states, l.name)));
    if (archive) {
      result.set(p.uuid, archive.controllerStatus === "RUNNING" ? "extracting" : "queued");
      continue;
    }
    const reported = mine.map((l) => l.extractionStatus).filter((s) => typeof s === "string");
    if (reported.some((s) => s.startsWith("ERROR"))) result.set(p.uuid, "failed");
    // One extracted archive says nothing about a package still coming down.
    else if (p.finished && reported.includes("SUCCESSFUL")) result.set(p.uuid, "extracted");
  }
  return result;
}

function rank(p) {
  if (p.running) return 0;
  if (p.finished) return 3;
  return p.enabled ? 1 : 2;
}

/**
 * What the popup shows while it is open: the download controller's state
 * and speed, the packages that are not finished, and what waits in the
 * LinkGrabber. Four device calls, in parallel.
 */
async function overview(device) {
  const call = (path, params) => client.call(() => client.deviceCall(device, path, params));
  const [state, speed, packages, links, queue, grabber, collecting] = await Promise.all([
    call("/downloadcontroller/getCurrentState"),
    call("/downloadcontroller/getSpeedInBps"),
    call("/downloadsV2/queryPackages", [PACKAGE_FIELDS]),
    // Only for the extraction status, which lives on the links.
    call("/downloadsV2/queryLinks", [{ name: true, packageUUID: true, extractionStatus: true, maxResults: -1, startAt: 0 }]),
    call("/extraction/getQueue"),
    call("/linkgrabberv2/queryPackages", [{ childCount: true, maxResults: -1, startAt: 0 }]),
    call("/linkgrabberv2/isCollecting"),
  ]);
  const all = Array.isArray(packages) ? packages : [];
  const extraction = extractionByPackage(all, Array.isArray(links) ? links : [], Array.isArray(queue) ? queue : []);
  return {
    state: typeof state === "string" ? state : "UNKNOWN",
    speed: typeof speed === "number" ? speed : 0,
    bytesLoaded: all.reduce((n, p) => n + (p.bytesLoaded ?? 0), 0),
    bytesTotal: all.reduce((n, p) => n + (p.bytesTotal ?? 0), 0),
    // Running first, then what is waiting, then what is disabled, then what is done.
    packages: all
      .map(({ uuid, name, bytesLoaded, bytesTotal, eta, running, enabled, finished, speed, childCount }) => ({
        uuid,
        name,
        bytesLoaded: bytesLoaded ?? 0,
        bytesTotal: bytesTotal ?? 0,
        eta: eta ?? -1,
        running: !!running,
        enabled: enabled !== false,
        finished: !!finished,
        speed: speed ?? 0,
        childCount: childCount ?? 0,
        extraction: extraction.get(uuid) ?? null,
      }))
      .sort((a, b) => rank(a) - rank(b)),
    grabber: {
      packages: Array.isArray(grabber) ? grabber.map((p) => p.uuid) : [],
      links: Array.isArray(grabber) ? grabber.reduce((n, p) => n + (p.childCount ?? 0), 0) : 0,
      collecting: collecting === true,
    },
  };
}

/** The popup's buttons. */
async function control(device, action) {
  const call = (path, params) => client.call(() => client.deviceCall(device, path, params));
  switch (action) {
    case "start":
      return call("/downloadcontroller/start");
    case "pause":
      return call("/downloadcontroller/pause", [true]);
    case "resume":
      return call("/downloadcontroller/pause", [false]);
    case "stop":
      return call("/downloadcontroller/stop");
    case "confirm": {
      // Everything in the LinkGrabber: the packages by id, with no link picked out.
      const grabbed = await call("/linkgrabberv2/queryPackages", [{ maxResults: -1, startAt: 0 }]);
      const ids = Array.isArray(grabbed) ? grabbed.map((p) => p.uuid) : [];
      if (ids.length === 0) return;
      return call("/linkgrabberv2/moveToDownloadlist", [[], ids]);
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
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
    case "container":
      return sendContainer(msg.device, msg.kind, msg.content);
    case "dialog":
      return openDialog(msg.text, msg.tab, { container: !!msg.container });
    case "overview":
      return overview(msg.device);
    case "control":
      return control(msg.device, msg.action);
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
