# Changelog

## 0.1.2 — November 12, 2026

- Added **Statuses to sync** in Obsidian. Select one or more of Suggestions, In progress, Finished, and Archived, then save. All four are enabled by default, including for existing settings.
- Manual and automatic sync check the item's current SirajHub status before importing it or updating its linked note. Sync skips excluded items and keeps their notes in the vault. It resumes when an item's status is selected again.

## 0.1.3 — November 12, 2026

- New notes use the item title as the filename, with a number added if the name is already taken. On the next eligible sync, older notes move their link into plugin data and lose the `sirajhub-id` and `sirajhub-account` properties and the ID suffix. Move or rename linked notes in Obsidian with Siraj Sync enabled so it can track their paths.
- Added **Note body template** for each content type. Use Markdown and placeholders such as `{{metadata.genres}}` to display SirajHub fields independently of property mappings. Sync refreshes the generated section and preserves text outside it. Clearing the template removes the generated section on the next sync.

## 0.1.6 — November 12, 2026

- Finished dates now sync from SirajHub as `YYYY-MM-DD`. New default mappings include `finishedAt = finished-date`. Add that line to an existing mapping, then set the Obsidian property type to **Date** to sort and filter by it. Sync also converts previously imported finish timestamps to the date format.
