/*
 * Click'n'Load, decoded.
 *
 * A site's Click'n'Load button posts to http://127.0.0.1:9666, where it
 * expects a JDownloader on this very machine. The links travel as
 * `crypted`, AES-128-CBC with the key used as iv too and the plaintext
 * padded with zero bytes, and the key is the 32 hex digits returned by the
 * small JavaScript function in `jk`. This turns the pair back into text;
 * catching the post is the content scripts' job.
 *
 * A classic script, like myjd.js, for the same three homes.
 */
(function (root) {
  "use strict";

  const subtle = root.crypto.subtle;

  function unhex(s) {
    const out = new Uint8Array(s.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  function unb64(s) {
    return Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  }

  /**
   * The key out of `jk`. Sites write it as `function f(){ return '…32 hex…'; }`,
   * sometimes with the digits split or decorated; the first run of 32 hex
   * digits is the key in every form seen in the wild, so no JavaScript is
   * ever run.
   */
  function keyOf(jk) {
    const m = String(jk).match(/[0-9a-fA-F]{32}/);
    if (!m) throw new Error("Click'n'Load: no key in jk.");
    return unhex(m[0]);
  }

  /**
   * AES-128-CBC without padding, which WebCrypto does not offer: the
   * ciphertext is extended by one block crafted so that it decrypts to a
   * full block of PKCS#7 padding, which WebCrypto then strips for us.
   * The crafted block is E(pad ⊕ last), which CBC encryption with iv = last
   * produces as its first block.
   */
  async function aesCbcNoPadding(keyBytes, iv, ct) {
    if (ct.length === 0 || ct.length % 16 !== 0) throw new Error("Click'n'Load: the data is not whole blocks.");
    const key = await subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt", "decrypt"]);
    const last = ct.slice(ct.length - 16);
    const pad = new Uint8Array(16).fill(16);
    const tail = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: last }, key, pad)).slice(0, 16);
    const extended = new Uint8Array(ct.length + 16);
    extended.set(ct);
    extended.set(tail, ct.length);
    return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv }, key, extended));
  }

  /** The links, one per line, out of a Click'n'Load post. */
  async function decrypt(crypted, jk) {
    const key = keyOf(jk);
    const plain = await aesCbcNoPadding(key, key, unb64(crypted));
    let end = plain.length;
    while (end > 0 && plain[end - 1] === 0) end--;
    return new TextDecoder().decode(plain.slice(0, end)).replace(/\r\n?/g, "\n").trim();
  }

  const cnl = { decrypt, keyOf };
  root.cnl = cnl;
  if (typeof module === "object" && module.exports) module.exports = cnl;
})(globalThis);
