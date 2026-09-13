// The protocol, byte for byte, against values from the reference Python
// client (myjdapi 1.1.x), then the client's session handling against a fake
// My.JDownloader that speaks the same protocol.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const myjd = require("../js/myjd.js");
const { Client, ApiError, secret, sha256, hmacHex, encrypt, decrypt, quote, hex, unhex, memoryStore, API_URL } = myjd;

const EMAIL = "Test.User@Example.com";
const PASSWORD = "pässword";

test("secrets match the reference", async () => {
  assert.equal(hex(await secret(EMAIL, PASSWORD, "server")), "646068ae4e3c8cc1d9be13609bdb1f18566bcf8ee02002d7aaf426823f899fa8");
  assert.equal(hex(await secret(EMAIL, PASSWORD, "device")), "b3648da41f19610f89afbe4c29de3821a5ac73360f8dac2665e47daa7fe9c029");
});

test("query encoding and signature match the reference", async () => {
  const query = `/my/connect?email=${quote(EMAIL)}&appkey=jdtui&rid=1700000000000`;
  assert.equal(query, "/my/connect?email=Test.User%40Example.com&appkey=jdtui&rid=1700000000000");
  const key = await secret(EMAIL, PASSWORD, "server");
  assert.equal(await hmacHex(key, query), "7a90bfb7c4a7b234306644c777174c0b5b1ba94177ecf8f77f996c7340c2d950");
});

test("quote encodes what Python's quote encodes", () => {
  assert.equal(quote("a b/c_d.e-f~g!h'i(j)k*l"), "a%20b/c_d.e-f~g%21h%27i%28j%29k%2Al");
});

test("aes-cbc matches the reference", async () => {
  const key = await secret(EMAIL, PASSWORD, "server");
  const plain = '{"hello":"wörld","n":1}';
  const encrypted = await encrypt(key, plain);
  assert.equal(encrypted, "4ItvyLMo6hhRuxmOgdgwMT0k1cKz2XcWCGfNse1e0cM=");
  assert.equal(await decrypt(key, encrypted), plain);
});

test("hex round trips", () => {
  assert.equal(hex(unhex("0001abff")), "0001abff");
});

// --- a fake My.JDownloader ---------------------------------------------------

/**
 * Enough of api.jdownloader.org to log in, list devices, reconnect and take a
 * device call. `expire()` kills the current session the way the real server
 * does after a while.
 */
async function fakeServer({ email, password, devices }) {
  const loginSecret = await secret(email, password, "server");
  const deviceSecret = await secret(email, password, "device");
  let session = null;
  let tokens = 0;
  const log = [];

  function json(status, body) {
    return new Response(JSON.stringify(body), { status });
  }

  async function newSession(base) {
    const sessionToken = hex(await sha256(new TextEncoder().encode(`session${++tokens}`)));
    const regainToken = hex(await sha256(new TextEncoder().encode(`regain${tokens}`)));
    const tokenBytes = unhex(sessionToken);
    session = {
      sessionToken,
      regainToken,
      serverKey: await sha256(base, tokenBytes),
      deviceKey: await sha256(deviceSecret, tokenBytes),
      alive: true,
    };
    return { sessiontoken: sessionToken, regaintoken: regainToken };
  }

  async function fetch(url, init) {
    const u = new URL(url);
    assert.equal(u.origin, API_URL);
    log.push(u.pathname);
    if (u.pathname.startsWith("/my/")) {
      const params = u.searchParams;
      const signature = params.get("signature");
      const signed = url.slice(API_URL.length, url.indexOf("&signature="));
      const rid = Number(params.get("rid"));
      const key = u.pathname === "/my/connect" ? loginSecret : session?.serverKey;
      if (!key) return json(403, { src: "MYJD", type: "TOKEN_INVALID" });
      // The real server cannot tell an unknown account from a wrong
      // password: both are a signature that does not verify.
      const connecting = u.pathname === "/my/connect";
      const wrongAccount = connecting && params.get("email")?.toLowerCase() !== email.toLowerCase();
      if (wrongAccount || (await hmacHex(key, signed)) !== signature) {
        return json(403, { src: "MYJD", type: connecting ? "AUTH_FAILED" : "TOKEN_INVALID" });
      }
      const reply = async (data) => new Response(await encrypt(key, JSON.stringify({ rid, ...data })));
      switch (u.pathname) {
        case "/my/connect":
          return reply(await newSession(loginSecret));
        case "/my/reconnect":
          if (!session?.alive || params.get("regaintoken") !== session.regainToken) {
            return json(403, { src: "MYJD", type: "TOKEN_INVALID" });
          }
          return reply(await newSession(session.serverKey));
        case "/my/listdevices":
          if (!session?.alive || params.get("sessiontoken") !== session.sessionToken) {
            return json(403, { src: "MYJD", type: "TOKEN_INVALID" });
          }
          return reply({ list: devices });
        case "/my/disconnect":
          session = null;
          return reply({});
        default:
          return json(404, { src: "MYJD", type: "UNKNOWN" });
      }
    }
    const m = u.pathname.match(/^\/t_([0-9a-f]+)_([^/]+)(\/.*)$/);
    assert.ok(m, `device path ${u.pathname}`);
    if (!session?.alive || m[1] !== session.sessionToken) return json(403, { src: "MYJD", type: "TOKEN_INVALID" });
    assert.equal(init.method, "POST");
    const envelope = JSON.parse(await decrypt(session.deviceKey, init.body));
    assert.equal(envelope.apiVer, 1);
    assert.equal(envelope.url, m[3]);
    const data =
      m[3] === "/linkgrabberv2/addLinks"
        ? { id: 1, job: JSON.parse(envelope.params[0]), device: decodeURIComponent(m[2]) }
        : ["/downloads", "/media"];
    return new Response(await encrypt(session.deviceKey, JSON.stringify({ rid: envelope.rid, data })));
  }

  return {
    fetch,
    log,
    expire: () => {
      if (session) session.alive = false;
    },
  };
}

const DEVICES = [{ id: "dev 1", name: "jd@home", type: "jd", status: "UNKNOWN" }];

test("login, list, and a device call", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const client = new Client(memoryStore());
  await client.login(EMAIL, PASSWORD);
  assert.deepEqual(await client.listDevices(), DEVICES);
  const job = { links: "https://example.com/a", autostart: true };
  const result = await client.addLinks("dev 1", job);
  assert.deepEqual(result.job, job);
  assert.equal(result.device, "dev 1");
  assert.deepEqual(await client.folderHistory("dev 1"), ["/downloads", "/media"]);
});

test("wrong credentials are refused and nothing is kept", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const store = memoryStore();
  const client = new Client(store);
  await assert.rejects(client.login("someone@else.com", PASSWORD), (e) => e instanceof ApiError && e.authFailed);
  assert.equal(client.loggedIn, false);
  assert.equal(await store.get(), undefined);
});

test("an expired session is renewed by reconnecting, and the key chains", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const client = new Client(memoryStore());
  await client.login(EMAIL, PASSWORD);
  server.log.length = 0;

  // The fake keeps the regain token valid while the session is merely stale,
  // so the cheap path wins.
  await client.reconnect();
  assert.deepEqual(server.log, ["/my/reconnect"]);
  assert.deepEqual(await client.listDevices(), DEVICES);
});

test("a session the server dropped is recovered transparently, secrets last", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const client = new Client(memoryStore());
  await client.login(EMAIL, PASSWORD);
  server.expire();
  server.log.length = 0;

  assert.deepEqual(await client.listDevices(), DEVICES);
  // Refused, tried the regain token, refused, connected from the secrets, retried.
  assert.deepEqual(server.log, ["/my/listdevices", "/my/reconnect", "/my/connect", "/my/listdevices"]);
});

test("a new instance picks the session up from storage", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const store = memoryStore();
  await new Client(store).login(EMAIL, PASSWORD);
  server.log.length = 0;

  const later = new Client(store);
  assert.deepEqual(await later.status(), { loggedIn: true, email: EMAIL });
  assert.deepEqual(await later.listDevices(), DEVICES);
  assert.deepEqual(server.log, ["/my/listdevices"], "no new session was needed");
});

test("concurrent callers share one renewal", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const store = memoryStore();
  await new Client(store).login(EMAIL, PASSWORD);
  server.expire();
  server.log.length = 0;

  const client = new Client(store);
  await Promise.all([client.listDevices(), client.listDevices(), client.folderHistory("dev 1")]);
  assert.equal(server.log.filter((p) => p === "/my/connect").length, 1);
});

test("signing out forgets everything", async () => {
  const server = await fakeServer({ email: EMAIL, password: PASSWORD, devices: DEVICES });
  globalThis.fetch = server.fetch;
  const store = memoryStore();
  const client = new Client(store);
  await client.login(EMAIL, PASSWORD);
  await client.logout();
  assert.equal(await store.get(), undefined);
  await assert.rejects(client.listDevices(), (e) => e.kind === "NOT_LOGGED_IN");
});

test("no session and no secrets is not logged in", async () => {
  const client = new Client(memoryStore());
  assert.deepEqual(await client.status(), { loggedIn: false, email: null });
});
