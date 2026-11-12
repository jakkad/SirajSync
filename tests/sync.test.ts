import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanFolder, createPayload, initialProperties, parseRules, planItem, serverOrigin, type Item } from "../src/model.ts";

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
