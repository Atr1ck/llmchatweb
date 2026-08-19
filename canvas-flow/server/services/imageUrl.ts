import { Buffer } from "node:buffer";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DATA_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function privateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254)
    || first === 127;
}

function isSafeRemoteUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname !== "localhost"
    && !hostname.endsWith(".localhost")
    && hostname !== "::1"
    && !privateIpv4(hostname);
}

function dataUrlByteLength(value: string): number | null {
  const match = DATA_IMAGE_RE.exec(value);
  if (!match || !match[2] || match[2].replace(/=/g, "").length % 4 === 1) return null;
  const bytes = Buffer.from(match[2], "base64");
  return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES ? bytes.length : null;
}

function mimeTypeFromUrl(value: string): string | undefined {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    const extension = pathname.slice(pathname.lastIndexOf(".") + 1);
    return MIME_BY_EXTENSION[extension];
  } catch {
    return undefined;
  }
}

/**
 * Converts a vision image into the format accepted by OpenAI-compatible APIs.
 * Invalid, private, expired, or non-image URLs return null instead of being
 * forwarded to the provider and producing an opaque HTTP 400.
 */
export async function materializeImageUrl(value: string, signal?: AbortSignal): Promise<string | null> {
  const trimmed = value.trim();
  if (dataUrlByteLength(trimmed) !== null) return trimmed;
  if (!isSafeRemoteUrl(trimmed)) return null;

  try {
    const response = await fetch(trimmed, { signal, redirect: "follow" });
    if (!response.ok) return null;
    const headerMime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const mimeType = headerMime?.startsWith("image/")
      ? headerMime
      : (!headerMime || headerMime === "application/octet-stream" ? mimeTypeFromUrl(trimmed) : undefined);
    if (!mimeType) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function materializeImageUrls(urls: string[]): Promise<string[]> {
  const materialized = await Promise.all(urls.map(async (url) => {
    const dataUrl = await materializeImageUrl(url);
    return dataUrl ?? url;
  }));
  return materialized;
}
