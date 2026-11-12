import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFolder, createPayload, initialProperties, parseRules, planItem, renderBody, serverOrigin, updateBody, validateBodyTemplate, type Item } from "../src/model.ts";

const item: Item = {
  id: "01HWWYZ2WDKEVC7JQZJ0AKTH3A", title: "The Dispossessed", contentType: "book",
  updatedAt: 1, rating: 5, notes: "From SirajHub", description: "First edition",
  metadata: '{"genres":["science fiction"],"isbn":"9780061054884"}',
};
const rules = parseRules("title = name\nrating = score\nnotes = commentary\ndescription = summary\nmetadata.isbn = ISBN\nmetadata.genres = genres", "book");

test("mappings support renamed fields and provider metadata; reserved and duplicate names are rejected", () => {
  assert.deepEqual(initialProperties(item, rules), {
    name: "The Dispossessed", score: 5, commentary: "From SirajHub", summary: "First edition",
    ISBN: "9780061054884", genres: ["science fiction"],
  });
  assert.throws(() => parseRules("title = name\nrating = Name", "book"), /Duplicate/);
  assert.throws(() => parseRules("title = sirajhub-id", "book"), /reserved/);
  assert.throws(() => parseRules("pageCount = pages", "movie"), /Unsupported/);
  assert.throws(() => cleanFolder("../Personal"), /inside the vault/);
  assert.throws(() => serverOrigin("http://siraj.example.com"), /HTTPS/);
});

test("a vault edit and a separate SirajHub edit merge, while a same-field conflict keeps both sides", async () => {
  const original = initialProperties(item, rules);
  const base = (await planItem(item, original, rules, {})).next;
  const remote = { ...item, notes: "Edited on the site", description: "Second edition" };
  const local = { ...original, score: 6, commentary: "Edited in the vault", personal: "keep local" };
  const plan = await planItem(remote, local, rules, base);
  assert.deepEqual(plan.writes, { rating: 6 });
  assert.deepEqual(plan.pulls, { summary: "Second edition" });
  assert.deepEqual(plan.problems, ["commentary: different values in Obsidian and SirajHub"]);
  const resolution = await planItem(remote, local, rules, base, "pull");
  assert.equal(resolution.pulls.commentary, "Edited on the site");
  assert.deepEqual(resolution.problems, []);
  const pushed = await planItem({ ...remote, rating: 6 }, local, rules, base, "normal", plan.writes);
  assert.deepEqual(pushed.writes, {});
  assert.notEqual(pushed.next["rating=score"], base["rating=score"]);
});

test("first sync after remapping does not send existing values to SirajHub without a baseline", async () => {
  const original = initialProperties(item, rules);
  const base = (await planItem(item, original, rules, {})).next;
  const remapped = parseRules("rating = personal-rating\nmetadata.isbn = isbn", "book");
  const plan = await planItem(item, { "personal-rating": 4 }, remapped, base);
  assert.deepEqual(plan.writes, {});
  assert.deepEqual(plan.pulls, { isbn: "9780061054884" });
  assert.equal(plan.problems.length, 1);
});

test("publishing sends only mapped writable properties, preserving the file name fallback", () => {
  assert.deepEqual(createPayload("book", { score: 7, ISBN: "x", personal: "private" }, rules, "My book"), {
    contentType: "book", title: "My book", rating: 7,
  });
  assert.throws(() => createPayload("book", { score: 8 }, rules, "My book"), /1 to 7/);
});

test("body templates render unmapped metadata and refresh only their own section", () => {
  const template = "## About\n\nGenres: {{ metadata.genres }}\n\n{{description}}";
  validateBodyTemplate(template, "book");
  assert.throws(() => validateBodyTemplate("{{pageCount}}", "movie"), /Unsupported body field/);
  const original = "Personal notes\r\n";
  const first = updateBody(original, renderBody(template, item), "\r\n");
  assert.match(first, /Genres: science fiction\r\n\r\nFirst edition/);
  const edited = first + "\r\n\r\nAnother personal note.";
  const refreshed = updateBody(edited, renderBody(template, { ...item, description: "Second edition" }), "\r\n");
  assert.equal(refreshed, edited.replace("First edition", "Second edition"));
  assert.equal(updateBody(refreshed, "", "\r\n"), original + "\r\n\r\nAnother personal note.");
  assert.throws(() => updateBody("<!-- siraj-sync:body -->\nMy notes", "", "\n"), /incomplete/);
});

test("linked mappings convert existing text and send edited link values as plain text", async () => {
  const book = { ...item, creator: "Ursula K. Le Guin" };
  const plainRules = parseRules("creator = author", "book");
  const linkRules = parseRules("creator = [[author]]\nmetadata.genres = [[genres]]", "book");
  const plain = initialProperties(book, plainRules);
  const base = (await planItem(book, plain, plainRules, {})).next;
  const linked = initialProperties(book, linkRules);
  assert.deepEqual(linked, { author: "[[Ursula K. Le Guin]]", genres: ["[[science fiction]]"] });
  assert.throws(() => parseRules("creator = [[author", "book"), /field = property/);
  assert.throws(() => parseRules("creator = [[author]]\ntitle = Author", "book"), /Duplicate/);

  const converted = await planItem(book, plain, linkRules, base);
  assert.deepEqual(converted.writes, {});
  assert.deepEqual(converted.pulls, linked);
  const custom = { ...linked, author: "[[Authors/Le Guin|Ursula K. Le Guin]]" };
  const unchanged = await planItem(book, custom, linkRules, converted.next);
  assert.deepEqual(unchanged.writes, {});
  assert.deepEqual(unchanged.pulls, {});
  const edited = { ...linked, author: "[[Authors/Butler|Octavia E. Butler]]" };
  const changed = await planItem(book, edited, linkRules, converted.next);
  assert.deepEqual(changed.writes, { creator: "Octavia E. Butler" });
  assert.equal(createPayload("book", edited, linkRules, "Book").creator, "Octavia E. Butler");
  const pulled = await planItem({ ...book, creator: "Samuel R. Delany" }, linked, linkRules, converted.next);
  assert.deepEqual(pulled.pulls, { author: "[[Samuel R. Delany]]" });
  const reverted = await planItem(book, linked, plainRules, converted.next);
  assert.deepEqual(reverted.writes, {});
  assert.deepEqual(reverted.pulls, plain);
});

test("finished dates import as calendar dates and migrate old timestamps", async () => {
  const timestamp = Date.parse("2026-11-12T23:30:00Z");
  const book = { ...item, finishedAt: timestamp };
  const dateRules = parseRules("finishedAt = finished-date", "book");
  const date = { "finished-date": "2026-11-12" };
  assert.deepEqual(initialProperties(book, dateRules), date);
  assert.deepEqual(initialProperties(item, dateRules), {});
  assert.equal(renderBody("Finished {{finishedAt}}", book), "Finished 2026-11-12");
  assert.deepEqual(createPayload("book", date, dateRules, "Book"), { contentType: "book", title: "Book" });

  const legacy = { "finished-date": timestamp };
  const legacyHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(timestamp)))).toString("hex");
  const base = { "finishedAt=finished-date": legacyHash };
  const migrated = await planItem(book, legacy, dateRules, base);
  assert.deepEqual(migrated.pulls, date);
  assert.deepEqual(migrated.writes, {});
  assert.deepEqual((await planItem({ ...book, finishedAt: timestamp + 86_400_000 }, legacy, dateRules, base)).pulls,
    { "finished-date": "2026-11-13" });
  assert.deepEqual((await planItem(item, legacy, dateRules, base)).pulls, { "finished-date": null });
  assert.deepEqual((await planItem(book, date, dateRules, migrated.next)).pulls, {});
});

test("cover mappings prefer cached files without sending vault links to SirajHub", async () => {
  const url = "https://covers.example.com/book.png";
  const cover = `[[SirajHub/Covers/0123456789abcdef/${item.id}.png]]`;
  const coverRules = parseRules("coverUrl = cover\ncoverImage = cover-image", "book");
  const online = { ...item, coverUrl: url };
  const downloaded = { ...online, coverImage: cover };
  const before = initialProperties(online, coverRules);
  const baseline = (await planItem(online, before, coverRules, {})).next;
  assert.deepEqual(initialProperties(downloaded, coverRules), { cover, "cover-image": cover });
  const migrated = await planItem(downloaded, before, coverRules, baseline);
  assert.deepEqual(migrated.pulls, { cover, "cover-image": cover });
  assert.deepEqual(migrated.writes, {});

  const local = { ...before, ...migrated.pulls };
  const changedUrl = "https://covers.example.com/second.jpg";
  const remoteChanged = await planItem({ ...downloaded, coverUrl: changedUrl }, local, coverRules, migrated.next);
  assert.deepEqual(remoteChanged.writes, {});
  assert.deepEqual(remoteChanged.pulls, {});
  const missing = await planItem(online, local, coverRules, migrated.next);
  assert.deepEqual(missing.pulls, { cover: url, "cover-image": null });
  assert.deepEqual(missing.writes, {});
  const edited = await planItem(downloaded, { ...local, cover: changedUrl }, coverRules, migrated.next);
  assert.deepEqual(edited.writes, { coverUrl: changedUrl });
  assert.throws(() => createPayload("book", local, coverRules, "Book"), /HTTP or HTTPS/);
});
