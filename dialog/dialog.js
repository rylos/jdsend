const viewSignedOut = document.getElementById("view-signed-out");
const viewForm = document.getElementById("view-form");
const form = document.getElementById("send-form");
const linksInput = document.getElementById("links");
const deviceSelect = document.getElementById("device");
const packageInput = document.getElementById("package-name");
const prioritySelect = document.getElementById("priority");
const folderInput = document.getElementById("folder");
const folderHistory = document.getElementById("folder-history");
const downloadPasswordInput = document.getElementById("download-password");
const extractPasswordInput = document.getElementById("extract-password");
const commentInput = document.getElementById("comment");
const autostartInput = document.getElementById("autostart");
const containerInput = document.getElementById("container");
const note = document.getElementById("form-note");
const btnSend = document.getElementById("btn-send");
const btnCancel = document.getElementById("btn-cancel");

const query = new URLSearchParams(window.location.search);
const sourceUrl = query.get("source") || undefined;

async function init() {
  linksInput.value = query.get("text") ?? "";

  const status = await ask("status");
  if (!status.loggedIn) {
    viewSignedOut.hidden = false;
    return;
  }
  viewForm.hidden = false;

  const settings = await loadSettings();
  prioritySelect.value = settings.priority;
  folderInput.value = settings.folder;
  autostartInput.checked = settings.autostart;

  try {
    await fillDevices(deviceSelect, settings.device);
    await loadFolderHistory();
  } catch (e) {
    showNote(note, e.message);
  }
  // Opened for a container: nothing to type, the file is what matters.
  if (query.get("container")) containerInput.focus();
  else (linksInput.value ? packageInput : linksInput).focus();
}

async function loadFolderHistory() {
  folderHistory.replaceChildren();
  const device = deviceSelect.value;
  if (!device) return;
  let folders = [];
  try {
    folders = await ask("folders", { device });
  } catch {
    // Suggestions only; the field works without them.
  }
  for (const folder of folders) {
    const option = document.createElement("option");
    option.value = folder;
    folderHistory.append(option);
  }
}

deviceSelect.addEventListener("change", loadFolderHistory);

// --- container files: DLC, CCF, RSDF -------------------------------------------

const CONTAINER_KINDS = ["dlc", "ccf", "rsdf"];

/** The lowercase extension of a container file, or null for anything else. */
function containerKind(file) {
  const kind = file?.name.split(".").pop()?.toLowerCase();
  return CONTAINER_KINDS.includes(kind) ? kind : null;
}

/** The file as a data URL, which is how JDownloader wants a container handed over. */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// A container dropped anywhere on the window lands in the file field.
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  const file = [...(event.dataTransfer?.files ?? [])].find(containerKind);
  if (!file) {
    showNote(note, "Only .dlc, .ccf and .rsdf files can be dropped here.");
    return;
  }
  const list = new DataTransfer();
  list.items.add(file);
  containerInput.files = list.files;
  hideNote(note);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideNote(note);
  const text = linksInput.value.trim();
  const file = containerInput.files?.[0] ?? null;
  if (file && !containerKind(file)) {
    showNote(note, "The container must be a .dlc, .ccf or .rsdf file.");
    return;
  }
  if (!text && !file) {
    showNote(note, "Nothing to send.");
    linksInput.focus();
    return;
  }
  if (!deviceSelect.value) {
    showNote(note, "No device to send to.");
    return;
  }

  btnSend.disabled = true;
  btnSend.textContent = "Sending…";
  try {
    const device = deviceSelect.value;
    if (file) {
      await ask("container", { device, kind: containerKind(file), content: await readAsDataUrl(file) });
    }
    if (text) {
      await ask("send", {
        device,
        text,
        options: {
          packageName: packageInput.value.trim(),
          folder: folderInput.value.trim(),
          priority: prioritySelect.value,
          comment: commentInput.value.trim(),
          downloadPassword: downloadPasswordInput.value,
          extractPassword: extractPasswordInput.value,
          autostart: autostartInput.checked,
          sourceUrl,
        },
      });
    }
    showNote(note, "Sent to JDownloader.", "success");
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    showNote(note, e.message);
    btnSend.disabled = false;
    btnSend.textContent = "Send";
  }
});

btnCancel.addEventListener("click", () => window.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.close();
});

init();
