# Changelog

## 1.3.0 — 2026-09-13

- Click'n'Load works with a JDownloader that is not on this machine: jdsend answers the site's check, catches the post, decodes the links and sends them to the chosen device. This adds a content script on every site and a redirect rule for `127.0.0.1:9666/jdcheck.js`.
- *Send a container file…* is its own button in the popup, opening the form empty with the file field ready.
- Finished packages say what became of their archives: extracting, extract queued, extracted, extraction failed.

## 1.2.0 — 2026-09-13

- Container files: the form takes a `.dlc`, `.ccf` or `.rsdf` from disk (pick it, or drop it on the window) and hands it to JDownloader whole, with or without links alongside.
- The popup opens the form even from a tab with no address, so a container can be sent from anywhere.

## 1.1.2 — 2026-09-13

- The status box folds out under a *Status* row with a chevron instead of a button.
- Finished packages are listed too, marked done with their size, and the summary says how much of the list is loaded; an empty list and an all-done list say so.

## 1.1.1 — 2026-09-13

- The popup opens in its final shape: the status box is closed until *Show status* is pressed, and the device is asked only from then on.
- Release notes come from the tag itself.

## 1.1.0 — 2026-09-13

- The popup shows the JDownloader at a glance: speed, the unfinished packages with their progress, what waits in the LinkGrabber; Start/Pause/Stop and *Confirm LinkGrabber* buttons. It asks the device every two seconds while open, and not at all otherwise.

## 1.0.1 — 2026-09-13

- The two context menu entries are now *Send to JDownloader now* and *Send with options…*; before, only an ellipsis told them apart.

## 1.0.0 — 2026-09-13

First release.

- Right-click anything — a link, an image, a video, selected text, the page — and *Send to JDownloader* hands it to the default device at once; *Send to JDownloader…* opens a form first (device, package, folder with JDownloader's own history, priority, passwords, comment, start now or wait in the LinkGrabber).
- The toolbar popup sends the current tab, and `Alt+Shift+J` does the same without opening anything.
- The outcome shows as a badge on the toolbar icon.
- Signs in once: the keys derived from the password are kept, the password is not, and a session My.JDownloader has forgotten is renewed on the next send without asking anyone.
- Chrome, Brave, Edge and Firefox from the same code.
- Talks only to api.jdownloader.org.
