// Runs in the page's own world, before its scripts. A Click'n'Load form
// that the page submits itself, with form.submit(), never fires a submit
// event, so that one call is wrapped: aimed at Click'n'Load's address, it
// is turned into an event for the content script; anything else goes
// through untouched.

(() => {
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    const m = String(this.getAttribute("action") ?? "").match(
      /^https?:\/\/(?:127\.0\.0\.1|localhost):9666\/flash\/(addcrypted2|add)(?:[/?#]|$)/,
    );
    if (!m) return submit.call(this);
    const fields = {};
    for (const [name, value] of new FormData(this)) if (typeof value === "string") fields[name] = value;
    // A string crosses between worlds; an object would not.
    document.dispatchEvent(new CustomEvent("jdsend-cnl", { detail: JSON.stringify({ kind: m[1], fields }) }));
  };
})();
