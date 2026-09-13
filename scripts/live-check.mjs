#!/usr/bin/env node
// Talk to the real My.JDownloader with the client the extension uses:
//
//   JDSEND_EMAIL=… JDSEND_PASSWORD=… node scripts/live-check.mjs
//
// Logs in, lists the devices, asks the first one for its folder history,
// reconnects, and signs out. Nothing is downloaded and nothing is kept.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const myjd = require("../js/myjd.js");

const email = process.env.JDSEND_EMAIL;
const password = process.env.JDSEND_PASSWORD;
if (!email || !password) {
  console.error("set JDSEND_EMAIL and JDSEND_PASSWORD");
  process.exit(2);
}

const client = new myjd.Client(myjd.memoryStore());
await client.login(email, password);
console.log("connected");

const devices = await client.listDevices();
console.log("devices:", devices.map((d) => `${d.name} (${d.status})`).join(", ") || "none");

if (devices[0]) {
  const folders = await client.folderHistory(devices[0].id);
  console.log(`folder history of ${devices[0].name}:`, folders);
}

await client.reconnect();
console.log("reconnected; devices still listed:", (await client.listDevices()).length);

await client.logout();
console.log("signed out");
