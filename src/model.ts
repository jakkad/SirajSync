export const TYPES = {
  book: "Books", movie: "Movies", tv: "TV shows", podcast: "Podcasts",
  youtube: "YouTube", article: "Articles", tweet: "Tweets",
} as const;
export type ContentType = keyof typeof TYPES;
export const ID = "sirajhub-id";
export const ACCOUNT = "sirajhub-account";
export const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const KEY = /^srj_sync_[a-f0-9]{64}$/;
export const STATUSES = {
  suggestions: "Suggestions", in_progress: "In progress", finished: "Finished", archived: "Archived",
} as const;
export type ItemStatus = keyof typeof STATUSES;
export const statusIds = Object.keys(STATUSES) as ItemStatus[];
const TEXT = ["title", "status", "creator", "description", "coverUrl", "releaseDate", "sourceUrl", "externalId", "notes"];
const NUMBERS = ["durationMins", "pageCount", "rating"];
const READ_ONLY = [
  "contentType", "subtitle", "progressPercent", "progressCurrent", "progressTotal",
  "createdAt", "updatedAt", "startedAt", "finishedAt", "lastTouchedAt",
];
type Rule = { field: string; property: string; writable: boolean; wikilink: boolean };
export type Settings = {
  server: string;
  secret: string;
  interval: number;
  removeUnmappedProperties: boolean;
  statuses: ItemStatus[];
  types: Record<ContentType, { folder: string; properties: string; body: string }>;
};
export type Item = Record<string, unknown> & { id: string; title: string; contentType: ContentType; updatedAt: number };
export type Properties = Record<string, unknown>;
export type Baseline = Record<string, string>;
export type Resolution = "normal" | "pull" | "push";

const COMMON = "title = title\ncreator = creator\nstatus = siraj-status\nfinishedAt = finished-date\nrating = siraj-rating\nsourceUrl = source\ncoverUrl = cover\nreleaseDate = release-date\ndescription = description\nnotes = siraj-notes";
const EXTRAS: Record<ContentType, string> = {
  book: "pageCount = pages\nmetadata.isbn = isbn\nmetadata.genres = genres",
  movie: "durationMins = runtime\nmetadata.genres = genres",
  tv: "metadata.seasonCount = seasons\nmetadata.genres = genres",
  podcast: "metadata.feedUrl = feed\nmetadata.episodeCount = episodes",
  youtube: "durationMins = runtime\nmetadata.channelId = channel-id",
  article: "metadata.siteName = site\nmetadata.wordCount = words\nmetadata.readingTimeMins = reading-minutes",
  tweet: "metadata.authorHandle = author-handle",
};

export function defaults(): Settings {
  return {
    server: "", secret: "", interval: 0, removeUnmappedProperties: false, statuses: [...statusIds],
    types: Object.fromEntries(Object.entries(TYPES).map(([type, label]) => [
      type, { folder: `SirajHub/${label}`, properties: `${COMMON}\n${EXTRAS[type as ContentType]}`, body: "" },
    ])) as Settings["types"],
  };
}

function supportsField(field: string, type: ContentType) {
  return (field !== "pageCount" || type === "book") &&
    (TEXT.includes(field) || NUMBERS.includes(field) || READ_ONLY.includes(field) ||
      /^metadata\.[\w-]+(?:\.[\w-]+)*$/.test(field));
}

export function parseRules(text: string, type: ContentType): Rule[] {
  const keys = new Set<string>();
  const properties = new Set([ID, ACCOUNT, "__proto__", "constructor", "prototype", "position"]);
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const match = /^([\w.]+)\s*=\s*(.+)$/u.exec(line.trim());
    const target = match?.[2] ?? "";
    const wikilink = target.startsWith("[[") && target.endsWith("]]");
    const property = wikilink ? target.slice(2, -2).trim() : target;
    if (!match || !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_. -]*$/u.test(property)) {
      throw Error(`Line ${index + 1}: use field = property or field = [[property]].`);
    }
    const field = match[1]!;
    const writable = TEXT.includes(field) || NUMBERS.includes(field);
    if (!supportsField(field, type)) {
      throw Error(`Unsupported field: ${field}.`);
    }
    if (keys.has(field) || properties.has(property.toLowerCase())) {
      throw Error(`Duplicate or reserved mapping: ${field} = ${property}.`);
    }
    keys.add(field);
    properties.add(property.toLowerCase());
    return [{ field, property, writable, wikilink }];
  });
}

const bodyStart = "<!-- siraj-sync:body -->";
const bodyEnd = "<!-- /siraj-sync:body -->";
const bodyField = /\{\{([^{}\r\n]+)\}\}/g;

export function validateBodyTemplate(template: string, type: ContentType) {
  for (const [, token] of template.matchAll(bodyField)) {
    const field = token!.trim();
    if (!supportsField(field, type)) throw Error(`Unsupported body field: ${field}.`);
  }
}

export function renderBody(template: string, item: Item): string {
  return template.replace(bodyField, (_, token: string) => {
    const value = valueAt(item, token.trim());
    return Array.isArray(value) ? value.join(", ") : String(value ?? "");
  }).replaceAll(bodyStart, "&lt;" + bodyStart.slice(1))
    .replaceAll(bodyEnd, "&lt;" + bodyEnd.slice(1)).trim();
}

export function updateBody(body: string, rendered: string, newline: string): string {
  const start = body.indexOf(bodyStart);
  const end = body.indexOf(bodyEnd);
  const block = rendered ? [bodyStart, rendered.replace(/\r?\n/g, newline), bodyEnd].join(newline) : "";
  if (start === -1 && end === -1) {
    if (!block) return body;
    return body + (body ? newline + newline : "") + block;
  }
  if (start === -1 || end < start || body.indexOf(bodyStart, start + 1) !== -1 || body.indexOf(bodyEnd, end + 1) !== -1) {
    throw Error("The Siraj Sync body markers are incomplete or duplicated. Check the note before syncing.");
  }
  const separator = newline + newline;
  const before = body.slice(0, start);
  const after = body.slice(end + bodyEnd.length);
  if (block) return before + block + after;
  return (before.endsWith(separator) ? before.slice(0, -separator.length) : before) + after;
}

export function serverOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw Error("Enter the SirajHub site URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw Error("Use the SirajHub HTTPS origin, without a path or credentials. HTTP is allowed on localhost.");
  }
  return url.origin;
}

export function cleanFolder(value: string): string {
  const folder = value.trim().replace(/\/+$/, "");
  if (value.trim() && (!folder || folder.split("/").some((part) => !part.trim() || part.startsWith(".") || /[\\:*?"<>|\u0000-\u001f]/.test(part)))) {
    throw Error("Enter a folder inside the vault, such as SirajHub/Books.");
  }
  return folder;
}

export function isType(value: unknown): value is ContentType {
  return typeof value === "string" && Object.hasOwn(TYPES, value);
}

export function isStatus(value: unknown): value is ItemStatus {
  return typeof value === "string" && Object.hasOwn(STATUSES, value);
}

function finishedDate(value: unknown): unknown {
  if (typeof value !== "number") return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function valueAt(item: Item, field: string) {
  if (field === "finishedAt") return finishedDate(item.finishedAt ?? null);
  if (!field.startsWith("metadata.")) return item[field] ?? null;
  let data: unknown = item.metadata;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  for (const part of field.slice(9).split(".")) {
    if (!data || typeof data !== "object" || !Object.hasOwn(data, part)) return null;
    data = (data as Properties)[part];
  }
  if (data && typeof data === "object" &&
      (!Array.isArray(data) || data.some((value) => value !== null && typeof value === "object"))) {
    // Obsidian Properties has no nested object type.
    return stable(data);
  }
  return data ?? null;
}

export function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString().slice(0, 10));
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => `${JSON.stringify(key)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validatedValue(field: string, value: unknown): unknown {
  if (field === "title") {
    if (typeof value !== "string" || !value.trim()) throw Error("title must contain text.");
    return value.trim();
  }
  if (field === "status") {
    if (!isStatus(value)) {
      throw Error(`status must be one of: ${statusIds.join(", ")}.`);
    }
    return value;
  }
  if (value == null || value === "") return null;
  if (field === "releaseDate" && value instanceof Date) return value.toISOString().slice(0, 10);
  if (NUMBERS.includes(field)) {
    const min = field === "durationMins" ? 0 : 1;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || (field === "rating" && value > 7)) {
      throw Error(field === "rating" ? "rating must be a whole number from 1 to 7." : `${field} must be a whole number of at least ${min}.`);
    }
    return value;
  }
  if (typeof value !== "string") throw Error(`${field} must contain text.`);
  return value;
}

function linkValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(linkValue);
  if (typeof value !== "string" || !value || value !== value.trim() || /[\[\]|#^:\r\n]|%%/.test(value)) return value;
  return `[[${value}]]`;
}

function unlinkValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unlinkValue);
  if (typeof value !== "string") return value;
  const match = /^\[\[([^\[\]|\r\n]+)(?:\|([^\[\]|\r\n]+))?\]\]$/.exec(value);
  return match ? (match[2] ?? match[1])!.trim() : value;
}

export function initialProperties(item: Item, rules: Rule[]): Properties {
  return Object.fromEntries(rules.map(({ field, property, wikilink }) => {
    const value = valueAt(item, field);
    return [property, wikilink ? linkValue(value) : value];
  })
    .filter(([, value]) => value != null));
}

export function createPayload(type: ContentType, props: Properties, rules: Rule[], filename: string) {
  const values: Properties = { contentType: type, title: validatedValue("title", filename) };
  for (const { field, property, writable, wikilink } of rules) {
    if (writable && Object.hasOwn(props, property) && props[property] != null && props[property] !== "") {
      values[field] = validatedValue(field, wikilink ? unlinkValue(props[property]) : props[property]);
    }
  }
  return values;
}

export async function planItem(
  item: Item, local: Properties, rules: Rule[], previous: Baseline, resolution: Resolution = "normal", accepted: Properties = {},
) {
  const writes: Properties = {};
  const pulls: Properties = {};
  const next: Baseline = {};
  const problems: string[] = [];

  await Promise.all(rules.map(async ({ field, property, writable, wikilink }) => {
    const plainKey = `${field}=${property}`;
    const linkKey = `link:${plainKey}`;
    const key = wikilink ? linkKey : plainKey;
    const wasLinked = Object.hasOwn(previous, linkKey);
    const base = previous[key] ?? previous[wikilink ? plainKey : linkKey];
    const remote = valueAt(item, field);
    const localValue = Object.hasOwn(local, property) ? local[property] : null;
    const localDisplay = field === "finishedAt" ? finishedDate(localValue) : localValue;
    const current = (wikilink || wasLinked) && stable(localDisplay) !== stable(remote) ? unlinkValue(localDisplay) : localDisplay;
    const [localHash, remoteHash] = await Promise.all([fingerprint(current), fingerprint(remote)]);
    // Older versions stored and hashed finishedAt as a millisecond timestamp.
    const legacyDate = base && field === "finishedAt" && typeof localValue === "number" && localHash !== base;
    const matchesBase = localHash === base || (legacyDate && await fingerprint(localValue) === base);
    if (localHash === remoteHash) {
      const formatted = wikilink ? linkValue(localDisplay) : current;
      if (stable(formatted) !== stable(localValue)) pulls[property] = formatted;
      next[key] = remoteHash;
    } else if (resolution === "pull" || Object.hasOwn(accepted, field) || (base ? matchesBase : !Object.hasOwn(local, property))) {
      pulls[property] = wikilink ? linkValue(remote) : remote;
      next[key] = remoteHash;
    } else if (writable && (resolution === "push" || (base && remoteHash === base))) {
      try { writes[field] = validatedValue(field, current); }
      catch (error) { problems.push(`${property}: ${(error as Error).message}`); }
    } else {
      problems.push(writable ? `${property}: different values in Obsidian and SirajHub`
        : `${property}: this property is read-only from SirajHub`);
    }
    if (!Object.hasOwn(next, key) && base) next[key] = base;
  }));

  return { writes, pulls, next, problems: problems.sort() };
}
