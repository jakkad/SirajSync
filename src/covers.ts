import { requestUrl } from "obsidian";

const imageTypes = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "image/gif": "gif", "image/avif": "avif",
} as const;
export type CoverExtension = (typeof imageTypes)[keyof typeof imageTypes];
export const coverExtensions: readonly CoverExtension[] = Object.values(imageTypes);

export async function coverFolder(account: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(account));
  const prefix = Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `SirajHub/Covers/${prefix}`;
}

function coverUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw Error("The cover URL is invalid."); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
      !host.includes(".") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host) ||
      /\.(?:localhost|local|internal|home|lan|test|invalid)$/.test(host)) {
    throw Error("The cover URL must point to a public image.");
  }
  return url.href;
}

function isImage(data: ArrayBuffer, extension: CoverExtension) {
  const bytes = new Uint8Array(data, 0, Math.min(32, data.byteLength));
  const ascii = String.fromCharCode(...bytes);
  switch (extension) {
    case "jpg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "png": return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    case "gif": return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
    case "webp": return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
    case "avif": return ascii.slice(4, 8) === "ftyp" && /avi[fs]/.test(ascii.slice(8));
  }
}

export async function downloadCover(value: string) {
  const url = coverUrl(value);
  let response;
  try {
    response = await requestUrl({
      url, throw: false, headers: { Accept: Object.keys(imageTypes).join(", "), "Cache-Control": "no-cache" },
    });
  } catch {
    throw Error("Could not reach the cover image.");
  }
  if (response.status !== 200) throw Error(`The cover image returned HTTP ${response.status}.`);
  const mime = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1]
    ?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extension = Object.hasOwn(imageTypes, mime) ? imageTypes[mime as keyof typeof imageTypes] : undefined;
  const data = response.arrayBuffer;
  if (data.byteLength > 10 * 1024 * 1024) throw Error("The cover image exceeds 10 MB.");
  if (!extension || !isImage(data, extension)) throw Error("The cover response is not a supported image.");
  return { extension, data };
}
