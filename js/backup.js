/* Backup and restore.

   The backup file leaves the tablet — it goes to Drive through the share
   sheet — and it carries names, IC numbers, phone numbers and addresses.
   So it is encrypted: AES-GCM, with the key derived from a passphrase she
   sets once in Setup.

   Restore still accepts the old plain v5 backups from v1.5, because those
   files already exist and must keep working. */

import { download, toast } from "./util.js";

const PBKDF2_ROUNDS = 250000;

function b64(buf){
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000){
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function unb64(str){
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hasCrypto(){
  return !!(window.crypto && window.crypto.subtle && window.isSecureContext);
}

async function deriveKey(passphrase, salt){
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name:"PBKDF2", salt, iterations:PBKDF2_ROUNDS, hash:"SHA-256" },
    base,
    { name:"AES-GCM", length:256 },
    false,
    ["encrypt","decrypt"]
  );
}

export async function encryptDump(dump, passphrase){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await deriveKey(passphrase, salt);
  const data = new TextEncoder().encode(JSON.stringify(dump));
  const ct   = await crypto.subtle.encrypt({ name:"AES-GCM", iv }, key, data);
  return {
    qi: "qi-tcm-backup",
    v: 6,
    enc: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    rounds: PBKDF2_ROUNDS,
    savedAt: new Date().toISOString(),
    salt: b64(salt),
    iv: b64(iv),
    data: b64(ct)
  };
}

export async function decryptEnvelope(env, passphrase){
  const key = await deriveKey(passphrase, unb64(env.salt));
  const pt  = await crypto.subtle.decrypt(
    { name:"AES-GCM", iv: unb64(env.iv) }, key, unb64(env.data)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

/* Writes the file and hands it to the share sheet when one is available,
   which is how it reaches Drive in two taps. Falls back to a download. */
export async function saveBackup(dump, settings, passphrase){
  let payload, name;
  const stamp = new Date().toISOString().slice(0,10);

  if (settings.encrypt){
    if (!hasCrypto()){
      toast("This browser can't encrypt. Open the app over https.");
      return false;
    }
    if (!passphrase){
      toast("Set a backup passphrase in Setup first.");
      return false;
    }
    payload = JSON.stringify(await encryptDump(dump, passphrase), null, 2);
    name = "qi-tcm-backup-" + stamp + ".enc.json";
  } else {
    payload = JSON.stringify(dump, null, 2);
    name = "qi-tcm-backup-" + stamp + ".json";
  }

  const blob = new Blob([payload], { type:"application/json" });
  const file = new File([blob], name, { type:"application/json" });

  if (navigator.canShare && navigator.canShare({ files:[file] })){
    try {
      await navigator.share({ files:[file], title:"Qi TCM backup" });
      return true;
    } catch(e){
      if (e && e.name === "AbortError") return false;
    }
  }
  download(name, blob);
  toast("Backup saved to your downloads.");
  return true;
}

/* Returns the dump, or throws. Handles v6 encrypted, v6 plain, and the
   v5 plain backups written by v1.5. */
export async function readBackupFile(text, askPassphrase){
  const parsed = JSON.parse(text);

  if (parsed && parsed.enc === "AES-GCM"){
    if (!hasCrypto()) throw new Error("This browser can't decrypt. Open the app over https.");
    const pass = await askPassphrase();
    if (!pass) throw new Error("cancelled");
    try {
      return await decryptEnvelope(parsed, pass);
    } catch(e){
      throw new Error("Wrong passphrase, or the file is damaged.");
    }
  }

  if (parsed && Array.isArray(parsed.bills)) return parsed;
  throw new Error("That file isn't a backup from this app.");
}

export function daysSince(iso){
  if (!iso) return Infinity;
  const then = new Date(iso).getTime();
  if (!then) return Infinity;
  return Math.floor((Date.now() - then) / 86400000);
}
