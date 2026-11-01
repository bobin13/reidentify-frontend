const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const MAX_PHOTO = 200 * 1024;
const MAX_REPLY = 300 * 1024;
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const storageError = (message, status = 503) => Object.assign(new Error(message), { status });
const defaultConfig = () => path.resolve(process.env.GOOGLE_DRIVE_CONFIG || path.join(__dirname, ".private", "google-drive.json"));

function validateConfig(value) {
  try {
    const url = new URL(value.url);
    if (value.provider !== "apps-script" || url.protocol !== "https:" ||
        url.hostname !== "script.google.com" || url.port || url.username ||
        url.password || url.search || url.hash ||
        !/^\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(url.pathname) ||
        typeof value.key !== "string" || !/^[a-f0-9]{64}$/.test(value.key)) throw Error();
    return { provider: "apps-script", url: url.href, key: value.key };
  } catch {
    throw storageError("Photo storage is not connected. In the backend terminal, run node connect-google-drive.cjs.");
  }
}

async function readConfig(file) {
  try { return validateConfig(JSON.parse(await fs.readFile(file, "utf8"))); }
  catch { throw storageError("Photo storage is not connected. In the backend terminal, run node connect-google-drive.cjs."); }
}

async function request(config, action, payload, fetcher) {
  const signal = AbortSignal.timeout(20000);
  try {
    let response = await fetcher(config.url, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...payload, action, key: config.key, deadline: Date.now() + 18000 }),
      redirect: "manual", signal,
    });
    // Follow Google's result redirect using GET, without the key or photo body.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      const target = location ? new URL(location, config.url) : null;
      if (![302, 303].includes(response.status) || !target ||
          target.protocol !== "https:" || target.hostname !== "script.googleusercontent.com" ||
          target.username || target.password || target.port) {
        await response.body?.cancel().catch(() => {});
        throw storageError('Check the script deployment: Execute as "Me", Who has access "Anyone", and use the /exec URL.');
      }
      await response.body?.cancel().catch(() => {});
      response = await fetcher(target.href, {
        method: "GET", headers: { Accept: "application/json" }, redirect: "error", signal,
      });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw storageError('Could not reach the photo script. Check its /exec URL and "Anyone" deployment setting.');
    }
    if (Number(response.headers.get("content-length")) > MAX_REPLY) {
      await response.body?.cancel().catch(() => {});
      throw storageError("Photo storage returned too much data.");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_REPLY) throw storageError("Photo storage returned too much data.");
      chunks.push(Buffer.from(chunk));
    }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw storageError('The photo script did not return JSON. Check its /exec URL, deploy the supplied Code.gs, and choose access "Anyone".'); }
    if (result?.ok !== true) {
      const messages = {
        FORBIDDEN: "The photo connection key does not match. Run node connect-google-drive.cjs again.",
        NOT_CONFIGURED: "In Apps Script, select setup and click Run before connecting the backend.",
        SHARED_FOLDER: "Make the ReIdentify photos folder and its files private in Google Drive.",
        BUSY: "Photo storage is busy. Please try again shortly.",
        EXPIRED: "Photo storage took too long. Please try again.",
        INVALID_PHOTO: "Choose a JPEG photo smaller than 200 KB.",
        NOT_FOUND: "This photo is no longer available.",
      };
      throw storageError(messages[result?.code] || "Photo storage is unavailable. Please try again later.", result?.code === "NOT_FOUND" ? 404 : 503);
    }
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw storageError("Photo storage could not connect. Please try again later.");
  }
}

function decodePhoto(jpeg) {
  if (typeof jpeg !== "string" || jpeg.length > Math.ceil(MAX_PHOTO / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(jpeg))
    throw storageError("The stored photo is invalid.");
  const bytes = Buffer.from(jpeg, "base64");
  if (bytes.length < 4 || bytes.length > MAX_PHOTO || bytes[0] !== 255 || bytes[1] !== 216)
    throw storageError("The stored photo is invalid.");
  return bytes;
}

function createDrivePhotoStore({ configPath = defaultConfig(), fetcher = fetch } = {}) {
  const call = async (action, payload = {}) => request(await readConfig(configPath), action, payload, fetcher);
  const checkId = (id) => { if (!validId(id)) throw storageError("Invalid photo reference."); };
  return {
    async newId() { return "ri_" + randomBytes(16).toString("hex"); },
    async put(id, jpeg, _existing, _owner) {
      checkId(id);
      if (!Buffer.isBuffer(jpeg)) throw storageError("Invalid photo data.");
      const encoded = jpeg.toString("base64");
      decodePhoto(encoded);
      await call("put", { id, jpeg: encoded });
    },
    async get(id) { checkId(id); return decodePhoto((await call("get", { id })).jpeg); },
    async remove(id) { checkId(id); await call("remove", { id }); },
    async check() {
      const result = await call("ping");
      if (result.service !== "reidentify-photos" || result.version !== 1)
        throw storageError("Deploy the supplied ReIdentify photo script, then connect again.");
      return result;
    },
  };
}

async function connectDrive({ configPath = defaultConfig(), url, key, fetcher = fetch, print = console.log } = {}) {
  if (!url || !key) {
    const { createInterface } = require("node:readline/promises");
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      print("Paste the two values from your Apps Script setup. Keep the connection key private.");
      url = url || (await terminal.question("Web app URL (ends with /exec): ")).trim();
      key = key || (await terminal.question("Connection key from setup's execution log: ")).trim();
    } finally { terminal.close(); }
  }
  const config = validateConfig({ provider: "apps-script", url, key });
  const result = await request(config, "ping", {}, fetcher);
  if (result.service !== "reidentify-photos" || result.version !== 1)
    throw storageError("Deploy the supplied ReIdentify photo script, then connect again.");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const temporary = configPath + "." + randomBytes(8).toString("hex") + ".tmp";
  try {
    await fs.writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temporary, configPath);
  } finally { await fs.rm(temporary, { force: true }); }
  print("Google Drive connected through Apps Script. Restart the backend.");
}

module.exports = { createDrivePhotoStore, connectDrive };
