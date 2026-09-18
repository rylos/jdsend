/*
 * My.JDownloader, as spoken by jdsend.
 *
 * Protocol per https://my.jdownloader.org/developers/: server calls are
 * signed GETs whose replies are AES-CBC encrypted, device calls are encrypted
 * POSTs, and every key derives from the e-mail and password once, so the
 * password itself is never kept.
 *
 * A classic script rather than a module, on purpose: the same file serves the
 * Chrome service worker (importScripts), the Firefox event page
 * (background.scripts) and Node (require, for the tests).
 */
(function (root) {
  "use strict";

  const API_URL = "https://api.jdownloader.org";
  const APP_KEY = "jdsend";
  const API_VERSION = 1;
  const CONTENT_TYPE = "application/aesjson-jd; charset=utf-8";
  /// Where the client's state lives in the extension's storage.
  const STORAGE_KEY = "myjd";

  const subtle = root.crypto.subtle;
  const utf8 = new TextEncoder();
  const text = new TextDecoder();

  // --- primitives ----------------------------------------------------------

  function concat(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  async function sha256(...parts) {
    return new Uint8Array(await subtle.digest("SHA-256", concat(...parts)));
  }

  function hex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function unhex(s) {
    const out = new Uint8Array(s.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  function b64(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function unb64(s) {
    return Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));
  }

  /** SHA-256 of lowercase e-mail + password + domain: the root of every key. */
  function secret(email, password, domain) {
    return sha256(utf8.encode(email.toLowerCase() + password + domain.toLowerCase()));
  }

  async function hmacHex(key, data) {
    const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(new Uint8Array(await subtle.sign("HMAC", k, utf8.encode(data))));
  }

  /** AES-128-CBC, PKCS#7, base64. The 32-byte token is iv then key. */
  async function encrypt(token, plain) {
    const key = await subtle.importKey("raw", token.slice(16, 32), "AES-CBC", false, ["encrypt"]);
    const out = await subtle.encrypt({ name: "AES-CBC", iv: token.slice(0, 16) }, key, utf8.encode(plain));
    return b64(new Uint8Array(out));
  }

  async function decrypt(token, data) {
    const key = await subtle.importKey("raw", token.slice(16, 32), "AES-CBC", false, ["decrypt"]);
    const out = await subtle.decrypt({ name: "AES-CBC", iv: token.slice(0, 16) }, key, unb64(data));
    return text.decode(out);
  }

  /**
   * Percent-encoding the way the server signs it: the set Python's
   * `urllib.parse.quote` leaves alone, which is narrower than
   * encodeURIComponent's.
   */
  function quote(s) {
    return encodeURIComponent(s)
      .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
      .replace(/%2F/gi, "/");
  }

  // --- errors --------------------------------------------------------------

  /**
   * `kind` is the server's error type (AUTH_FAILED, TOKEN_INVALID, OFFLINE,
   * OUTDATED, …) or one of ours: TRANSPORT, BAD_RESPONSE, NOT_LOGGED_IN.
   */
  class ApiError extends Error {
    constructor(kind, detail) {
      super(detail ? `${kind}: ${detail}` : kind);
      this.name = "ApiError";
      this.kind = kind;
    }

    /** The session is gone; a reconnect is worth trying. */
    get sessionExpired() {
      return this.kind === "TOKEN_INVALID" || this.kind === "SESSION_EXPIRED";
    }

    /** The credentials themselves were refused. */
    get authFailed() {
      return this.kind === "AUTH_FAILED" || this.kind === "EMAIL_INVALID";
    }
  }

  /** What to tell a person about an error. */
  function explain(error) {
    const kind = error instanceof ApiError ? error.kind : null;
    switch (kind) {
      case "NOT_LOGGED_IN":
        return "Not signed in: open jdsend from the toolbar and sign in.";
      case "AUTH_FAILED":
      case "EMAIL_INVALID":
        return "My.JDownloader refused the e-mail or password.";
      case "OFFLINE":
        return "That JDownloader is offline.";
      case "TRANSPORT":
        return "Could not reach My.JDownloader.";
      case "TOO_MANY_REQUESTS":
        return "My.JDownloader is rate limiting; try again in a minute.";
      case "BAD_RESPONSE":
        return "My.JDownloader answered something unexpected.";
      case null:
        return error?.message ?? String(error);
      default:
        return `My.JDownloader says ${kind}.`;
    }
  }

  async function parseError(response, body, key) {
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      try {
        parsed = JSON.parse(await decrypt(key, body));
      } catch {
        parsed = null;
      }
    }
    if (parsed && typeof parsed.type === "string") return new ApiError(parsed.type, parsed.src);
    return new ApiError(`HTTP ${response.status}`, body.slice(0, 200));
  }

  // --- storage -------------------------------------------------------------

  /** Persistence in an extension storage area, such as `chrome.storage.local`. */
  function storageStore(area) {
    return {
      get: async () => (await area.get(STORAGE_KEY))[STORAGE_KEY],
      set: (value) => area.set({ [STORAGE_KEY]: value }),
      remove: () => area.remove(STORAGE_KEY),
    };
  }

  /** Persistence that forgets: tests and one-off scripts. */
  function memoryStore() {
    let value;
    return {
      get: async () => value,
      set: async (v) => {
        value = v;
      },
      remove: async () => {
        value = undefined;
      },
    };
  }

  // --- client --------------------------------------------------------------

  class Client {
    constructor(store) {
      this.store = store;
      this.email = null;
      /** @type {Uint8Array|null} */ this.loginSecret = null;
      /** @type {Uint8Array|null} */ this.deviceSecret = null;
      /** @type {{sessionToken: string, regainToken: string, serverKey: Uint8Array, deviceKey: Uint8Array}|null} */
      this.session = null;
      this.lastRid = 0;
      this.restored = false;
      /** @type {Promise<void>|null} */ this.renewing = null;
    }

    get loggedIn() {
      return this.loginSecret !== null;
    }

    /** Derive the secrets, open a session and keep both. Throws if refused. */
    async login(email, password) {
      this.email = email;
      this.loginSecret = await secret(email, password, "server");
      this.deviceSecret = await secret(email, password, "device");
      this.session = null;
      this.restored = true;
      try {
        await this.connect();
      } catch (e) {
        this.email = this.loginSecret = this.deviceSecret = null;
        throw e;
      }
    }

    /** Forget everything, telling the server first when there is a session. */
    async logout() {
      await this.restore();
      if (this.session) {
        try {
          await this.serverGet("/my/disconnect", [["sessiontoken", this.session.sessionToken]]);
        } catch {
          // Best effort: the session dies on its own soon enough.
        }
      }
      this.email = this.loginSecret = this.deviceSecret = this.session = null;
      await this.store.remove();
    }

    async status() {
      await this.restore();
      return { loggedIn: this.loggedIn, email: this.email };
    }

    /** Load what an earlier run kept. Once per instance. */
    async restore() {
      if (this.restored) return;
      this.restored = true;
      const s = await this.store.get();
      if (!s?.loginSecret) return;
      this.email = s.email;
      this.loginSecret = unhex(s.loginSecret);
      this.deviceSecret = unhex(s.deviceSecret);
      if (s.sessionToken) {
        this.session = {
          sessionToken: s.sessionToken,
          regainToken: s.regainToken,
          serverKey: unhex(s.serverKey),
          deviceKey: unhex(s.deviceKey),
        };
      }
    }

    async persist() {
      const s = this.session;
      await this.store.set({
        email: this.email,
        loginSecret: hex(this.loginSecret),
        deviceSecret: hex(this.deviceSecret),
        sessionToken: s?.sessionToken,
        regainToken: s?.regainToken,
        serverKey: s ? hex(s.serverKey) : undefined,
        deviceKey: s ? hex(s.deviceKey) : undefined,
      });
    }

    /** A fresh session from the secrets; the reply is encrypted with the login secret. */
    async connect() {
      this.session = null;
      const resp = await this.serverGet("/my/connect", [
        ["email", this.email],
        ["appkey", APP_KEY],
      ]);
      await this.installSession(resp, this.loginSecret);
    }

    /** Renew a session that expired, without the secrets. */
    async reconnect() {
      const s = this.session;
      if (!s) throw new ApiError("NOT_LOGGED_IN");
      const resp = await this.serverGet("/my/reconnect", [
        ["sessiontoken", s.sessionToken],
        ["regaintoken", s.regainToken],
      ]);
      await this.installSession(resp, s.serverKey);
    }

    async installSession(resp, base) {
      if (typeof resp.sessiontoken !== "string" || typeof resp.regaintoken !== "string") {
        throw new ApiError("BAD_RESPONSE", "no session in the reply");
      }
      const tokenBytes = unhex(resp.sessiontoken);
      // The server key chains: after a reconnect it derives from the
      // previous server key, not from the login secret.
      this.session = {
        sessionToken: resp.sessiontoken,
        regainToken: resp.regaintoken,
        serverKey: await sha256(base, tokenBytes),
        deviceKey: await sha256(this.deviceSecret, tokenBytes),
      };
      await this.persist();
    }

    /** Make sure there is a session, run `fn`, and recover once if the session had died meanwhile. */
    async call(fn) {
      await this.restore();
      if (!this.loginSecret) throw new ApiError("NOT_LOGGED_IN");
      if (!this.session) await this.renew();
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        // OUTDATED: the request id was not newer than the last one seen.
        if (e.kind === "OUTDATED") return fn();
        // A request signed with a session key comes back AUTH_FAILED when the
        // server no longer knows that session: it has no key left to verify
        // the signature with, so a dead session and a bad signature look the
        // same to it. It never means the credentials are wrong -- those travel
        // on /my/connect alone. The regain token died with the session, so
        // clearing it here sends `renew` straight to a fresh connect.
        if (e.authFailed && this.session) {
          this.session = null;
          await this.renew();
          return fn();
        }
        if (e.sessionExpired) {
          await this.renew();
          return fn();
        }
        throw e;
      }
    }

    /** Reconnect, or connect afresh when that is refused. Concurrent callers share one attempt. */
    renew() {
      if (this.renewing) return this.renewing;
      this.renewing = (async () => {
        try {
          if (this.session) {
            try {
              await this.reconnect();
              return;
            } catch (e) {
              if (!(e instanceof ApiError) || e.kind === "TRANSPORT") throw e;
            }
          }
          await this.connect();
        } finally {
          this.renewing = null;
        }
      })();
      return this.renewing;
    }

    // --- what the extension asks for --------------------------------------

    /** @returns {Promise<Array<{id: string, name: string, type: string, status: string}>>} */
    listDevices() {
      return this.call(async () => {
        const resp = await this.serverGet("/my/listdevices", [["sessiontoken", this.session.sessionToken]]);
        return resp.list ?? [];
      });
    }

    /** Hand a LinkCollectingJob to a device's LinkGrabber. */
    addLinks(deviceId, job) {
      return this.call(() => this.deviceCall(deviceId, "/linkgrabberv2/addLinks", [job]));
    }

    /** The download folders a device has been told to use before. */
    folderHistory(deviceId) {
      return this.call(async () => {
        const list = await this.deviceCall(deviceId, "/linkgrabberv2/getDownloadFolderHistorySelectionBase");
        return Array.isArray(list) ? list.filter((f) => typeof f === "string") : [];
      });
    }

    // --- wire ---------------------------------------------------------------

    /** Request ids must increase within a session; the clock alone repeats within a millisecond. */
    nextRid() {
      this.lastRid = Math.max(Date.now(), this.lastRid + 1);
      return this.lastRid;
    }

    async serverGet(path, params) {
      const rid = this.nextRid();
      const pairs = params.map(([k, v]) => `${k}=${quote(v)}`);
      pairs.push(`rid=${rid}`);
      const query = `${path}?${pairs.join("&")}`;
      // Before a session exists the login secret signs and decrypts.
      const key = this.session ? this.session.serverKey : this.loginSecret;
      const signature = await hmacHex(key, query);
      const response = await this.fetch(`${API_URL}${query}&signature=${signature}`);
      const body = await response.text();
      if (!response.ok) throw await parseError(response, body, key);
      let data;
      try {
        data = JSON.parse(await decrypt(key, body));
      } catch {
        throw new ApiError("BAD_RESPONSE", "the reply did not decrypt");
      }
      if (data.rid !== undefined && data.rid !== rid) throw new ApiError("BAD_RESPONSE", "request id mismatch");
      return data;
    }

    /** `params` are serialised one by one, each as its own JSON string, as the server expects. */
    async deviceCall(deviceId, path, params = []) {
      const s = this.session;
      if (!s) throw new ApiError("NOT_LOGGED_IN");
      const rid = this.nextRid();
      const envelope = JSON.stringify({ url: path, params: params.map((p) => JSON.stringify(p)), rid, apiVer: API_VERSION });
      const body = await encrypt(s.deviceKey, envelope);
      const response = await this.fetch(`${API_URL}/t_${s.sessionToken}_${quote(deviceId)}${path}`, {
        method: "POST",
        headers: { "Content-Type": CONTENT_TYPE },
        body,
      });
      const reply = await response.text();
      if (!response.ok) throw await parseError(response, reply, s.deviceKey);
      let parsed;
      try {
        parsed = JSON.parse(await decrypt(s.deviceKey, reply));
      } catch {
        throw new ApiError("BAD_RESPONSE", "the reply did not decrypt");
      }
      if (parsed.rid !== rid) throw new ApiError("BAD_RESPONSE", "request id mismatch");
      return parsed.data;
    }

    async fetch(url, init) {
      try {
        return await root.fetch(url, init);
      } catch (e) {
        throw new ApiError("TRANSPORT", e.message);
      }
    }
  }

  const myjd = { Client, ApiError, explain, secret, sha256, hmacHex, encrypt, decrypt, quote, hex, unhex, storageStore, memoryStore, API_URL, APP_KEY };
  root.myjd = myjd;
  if (typeof module === "object" && module.exports) module.exports = myjd;
})(globalThis);
