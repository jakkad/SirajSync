import { requestUrl } from "obsidian";
import { isType, ULID, type Item, type Properties } from "./model.ts";

function itemFrom(value: unknown): Item {
  if (!value || typeof value !== "object") throw Error("SirajHub returned an invalid item.");
  const item = value as Item;
  if (typeof item.id !== "string" || !ULID.test(item.id) || typeof item.title !== "string" ||
      !isType(item.contentType) || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0) {
    throw Error("SirajHub returned an unsupported item.");
  }
  return item;
}

export class SirajApi {
  constructor(readonly origin: string, private readonly key: string) {}

  private async request(path: string, method = "GET", data?: Properties, revision?: number): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.key}`,
    };
    if (revision !== undefined) headers["If-Match"] = `"${revision}"`;
    let res;
    try {
      res = await requestUrl({
        url: `${this.origin}${path}`, method, headers, throw: false,
        ...(data && { contentType: "application/json", body: JSON.stringify(data) }),
      });
    } catch {
      throw Error("Could not reach SirajHub. Check the site URL and your network connection.");
    }
    if (res.status === 401 || res.status === 403) throw Error("SirajHub rejected the sync key. Check or replace it in Settings.");
    if (res.status === 404 && path === "/api/sync/account") throw Error("This SirajHub server does not support Obsidian sync yet.");
    if (res.status === 409) throw Error("SirajHub found a potential duplicate. Review the item on the site.");
    if (res.status === 412) throw Error("This item changed in SirajHub during sync. Run sync again.");
    if (res.status >= 400 || res.status < 200) throw Error(`SirajHub returned HTTP ${res.status}.`);
    try { return res.json as unknown; } catch { throw Error("The server did not return SirajHub sync data."); }
  }

  async account(): Promise<string> {
    const result = await this.request("/api/sync/account") as { accountId?: unknown; protocolVersion?: unknown } | null;
    if (result?.protocolVersion !== 1 || typeof result.accountId !== "string" || !result.accountId) {
      throw Error("This SirajHub server does not support Obsidian sync protocol 1.");
    }
    return `${this.origin}#${result.accountId}`;
  }

  async items(): Promise<Item[]> {
    const result: Item[] = [];
    let after: string | null = null;
    do {
      const page = await this.request(`/api/sync/items${after ? `?after=${after}` : ""}`) as
        { items?: unknown[]; next?: unknown } | null;
      if (!Array.isArray(page?.items) || (page.next !== null &&
        (typeof page.next !== "string" || !ULID.test(page.next) || (after && page.next <= after)))) {
        throw Error("SirajHub returned an invalid sync page.");
      }
      result.push(...page.items.map(itemFrom));
      after = page.next as string | null;
    } while (after);
    return result;
  }

  async patch(item: Item, fields: Properties): Promise<Item> {
    const updated = itemFrom(await this.request(`/api/items/${item.id}`, "PATCH", fields, item.updatedAt));
    if (updated.id !== item.id) throw Error("SirajHub returned the wrong item.");
    return updated;
  }

  async create(fields: Properties): Promise<Item> {
    return itemFrom(await this.request("/api/items", "POST", fields));
  }
}
