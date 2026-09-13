# jdsend

Send links to [JDownloader](https://jdownloader.org/) from the browser, through My.JDownloader.

Right-click a link, an image, a video, some selected text or the page itself and pick **Send to jd2@home** — the entry is named after the JDownloader chosen in the options — and it goes to your JDownloader straight away, wherever it runs, and the toolbar icon says whether it arrived. **Send with options…** opens a small form first, for when the package, the folder, the priority or a password matter. The toolbar button sends the current tab; so does `Alt+Shift+J`.

Unfold *Status* in the popup for a glance at the JDownloader: speed, what is downloading and how far along, what waits in the LinkGrabber, with Start/Pause/Stop and a button to confirm the whole LinkGrabber. It asks only while the popup is open.

Sign in once. The extension keeps the keys derived from your password, not the password, and when My.JDownloader forgets the session it renews it on the next send. There is no polling: jdsend talks to api.jdownloader.org only when you send something, and to nowhere else.

Companion of [jdtui](https://github.com/rylos/jdtui), a terminal UI for the same JDownloader.

## Install

Grab the zip for your browser from the [latest release](https://github.com/rylos/jdsend/releases/latest).

**Chrome, Brave, Edge, Vivaldi, Opera** — unzip it somewhere it can stay, open the browser's extensions page (`chrome://extensions`, `brave://extensions`, `edge://extensions`), turn on *Developer mode* and choose *Load unpacked* on the folder. Or clone this repository and load the checkout itself: `git pull` and the ↻ on the extension's card is then all an update takes.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* on the Firefox zip. Firefox forgets temporary add-ons when it closes; a permanent install needs the add-on signed by Mozilla, which is on the list.

Then click the toolbar icon, sign in with your My.JDownloader account and, if you have more than one JDownloader, pick the one to send to. The context menu, the popup and the shortcut are ready from there.

## Links typed or pasted, and container files

*Send links or a container…* in the popup opens the form empty: paste links or any text with links in it, and/or pick a `.dlc`, `.ccf` or `.rsdf` — or drop one on the window — and it goes to JDownloader whole. The same form is behind *Send with options…*, so a container can travel with a page's links too.

## Options

Right-click the toolbar icon → *Options* (or the popup's *Options* link):

- **Device** — where quick sends go. With none chosen, every send opens the form.
- **Priority**, **Download folder**, **Start right away** — what a quick send uses, and what the form starts from. A folder set here beats JDownloader's packagizer rules; leave it empty and the rules decide.
- **Remember whether Status is unfolded** — off by default, so the popup opens folded and asks the JDownloader nothing until you unfold it. On, it opens the way you left it.

The shortcut is changed where the browser keeps extension shortcuts (`chrome://extensions/shortcuts`, or *Manage Extension Shortcuts* in Firefox's add-ons page).

## What it sends, and where

Everything goes to `https://api.jdownloader.org`, the My.JDownloader relay, encrypted end to end with keys only your JDownloader shares — the same protocol JDownloader's own web interface and apps use. jdsend has no server of its own, does not check for updates, and does not phone anywhere else. It runs no code on the pages you visit.

Signing in derives two keys from the e-mail and password and keeps them in the browser's extension storage; the password itself is discarded. Those keys let jdsend open sessions on your behalf without asking again — which also means they are worth as much as the password, as they are in JDownloader itself. *Sign out* in the popup forgets them and ends the session on the server.

## Verify a download

Every release is built by GitHub Actions and signed with the maintainer's SSH key; the public half is in [`.github/allowed_signers`](.github/allowed_signers), fingerprint `SHA256:A8FoTqTFZrY18WXrAuT1mA2xnmoc4xTDCNIzkQPRjdA`. To check the checksums and, through them, the zips:

```sh
ssh-keygen -Y verify -f allowed_signers -I rylos78@gmail.com -n file -s SHA256SUMS.sig < SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

Commits and tags are signed with the same key.

## Development

Plain JavaScript, no build step, no dependencies. The source tree is a Chrome extension as it is; `scripts/package.sh` produces the Chrome zip and the Firefox one, whose manifest differs only in the background page and the add-on id.

```sh
node --test                       # the protocol against reference vectors, the client against a fake server
scripts/package.sh                # dist/jdsend-<version>-{chrome,firefox}.zip
JDSEND_EMAIL=… JDSEND_PASSWORD=… node scripts/live-check.mjs   # a real login, list, reconnect and sign out
```

`js/myjd.js` is the whole My.JDownloader client and has no browser in it: it runs in the Chrome service worker, the Firefox event page and Node alike.

## License

MIT — see [LICENSE](LICENSE).
