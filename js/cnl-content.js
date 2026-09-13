// Runs in every page, in the extension's own world, and does one thing:
// when a form is about to post to Click'n'Load's address on this machine,
// it takes the form's fields to the background page instead, which decodes
// them and sends the links to the JDownloader chosen there — wherever that
// one runs. It reads nothing else on the page.

(() => {
  const ext = globalThis.browser ?? globalThis.chrome;

  /** "addcrypted2" or "add" when `action` is a Click'n'Load address, else null. */
  function cnlKind(action) {
    const m = String(action ?? "").match(/^https?:\/\/(?:127\.0\.0\.1|localhost):9666\/flash\/(addcrypted2|add)(?:[/?#]|$)/);
    return m ? m[1] : null;
  }

  function hand(kind, fields) {
    ext.runtime.sendMessage({ type: "cnl", kind, fields, source: location.href });
  }

  // Forms submitted the ordinary way: a button, Enter, requestSubmit().
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      // form.action would hand back an <input name="action"> if there is one.
      const kind = cnlKind(form.getAttribute("action"));
      if (!kind) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const fields = {};
      for (const [name, value] of new FormData(form)) if (typeof value === "string") fields[name] = value;
      hand(kind, fields);
    },
    true,
  );

  // Forms submitted by script, form.submit(), fire no event; the page-world
  // script catches those and passes them here.
  document.addEventListener("jdsend-cnl", (event) => {
    try {
      const { kind, fields } = JSON.parse(event.detail);
      if (cnlKind(`http://127.0.0.1:9666/flash/${kind}`)) hand(kind, fields);
    } catch {
      // Not ours.
    }
  });
})();
