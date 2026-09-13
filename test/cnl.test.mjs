// Click'n'Load decoding against Node's own AES, which can do CBC without
// padding, the way the sites encrypt.
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const cnl = require("../js/cnl.js");

/** Encrypt the way a Click'n'Load site does: zero-padded, key as iv. */
function encryptLikeASite(keyHex, text) {
  const key = Buffer.from(keyHex, "hex");
  const plain = Buffer.from(text, "utf8");
  const padded = Buffer.concat([plain, Buffer.alloc((16 - (plain.length % 16)) % 16)]);
  const cipher = createCipheriv("aes-128-cbc", key, key);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

const KEY = "31323334353637383930313233343536";
const LINKS = "https://example.com/file/one\nhttps://example.com/file/two\n";

test("the key is read out of jk without running it", () => {
  assert.equal(Buffer.from(cnl.keyOf(`function f(){ return '${KEY}';}`)).toString("hex"), KEY);
  assert.equal(Buffer.from(cnl.keyOf(`function f(){var a='${KEY.toUpperCase()}';return a}`)).toString("hex"), KEY);
  assert.throws(() => cnl.keyOf("function f(){ return 'nope'; }"), /no key/);
});

test("crypted decodes to the links", async () => {
  const jk = `function f(){ return '${KEY}';}`;
  assert.equal(await cnl.decrypt(encryptLikeASite(KEY, LINKS), jk), LINKS.trim());
});

test("a plaintext that fills its last block whole decodes too", async () => {
  const text = "x".repeat(32);
  assert.equal(await cnl.decrypt(encryptLikeASite(KEY, text), KEY), text);
});

test("a random key and windows line endings", async () => {
  const key = randomBytes(16).toString("hex");
  const links = "https://a.example/1\r\nhttps://a.example/2";
  const crypted = encryptLikeASite(key, links).replace(/(.{20})/g, "$1\n");
  assert.equal(await cnl.decrypt(crypted, `function f(){return '${key}'}`), "https://a.example/1\nhttps://a.example/2");
});
