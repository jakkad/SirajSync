# Changelog

## 0.1.2 — November 12, 2026

- Added **Statuses to sync** in Obsidian. Select one or more of Suggestions, In progress, Finished, and Archived, then save. All four are enabled by default, including for existing settings.
- Manual and automatic sync check the item's current SirajHub status before importing it or updating its linked note. Sync skips excluded items and keeps their notes in the vault. It resumes when an item's status is selected again.

## 0.1.3 — November 12, 2026

- New notes use the item title as the filename, with a number added if the name is already taken. On the next eligible sync, older notes move their link into plugin data and lose the `sirajhub-id` and `sirajhub-account` properties and the ID suffix. Move or rename linked notes in Obsidian with Siraj Sync enabled so it can track their paths.
- Added **Note body template** for each content type. Use Markdown and placeholders such as `{{metadata.genres}}` to display SirajHub fields independently of property mappings. Sync refreshes the generated section and preserves text outside it. Clearing the template removes the generated section on the next sync.

## 0.1.6 — November 12, 2026

- Finished dates now sync from SirajHub as `YYYY-MM-DD`. New default mappings include `finishedAt = finished-date`. Add that line to an existing mapping, then set the Obsidian property type to **Date** to sort and filter by it. Sync also converts previously imported finish timestamps to the date format.

## 0.1.7 — November 12, 2026

- Sync saves cover images in the vault under `SirajHub/Covers/`. It reuses saved files and retries missing ones by default. Enable **Redownload covers on every sync** to refresh saved images.

## 0.1.8 — November 12, 2026

- Added a progress notice that shows how many items sync has checked and which cover it is downloading. Manual sync shows it immediately, and automatic sync shows it after one second. Use **Show sync progress** to reopen the notice while sync is running.

## 0.1.9 — November 12, 2026

- Existing mappings such as `coverUrl = cover` now point to the downloaded cover in the vault. Sync reuses covers already saved and falls back to the source URL if a local copy is unavailable. SirajHub continues to store the source URL.

## 0.1.10 — November 12, 2026

- Added **Covers folder** to choose where Siraj Sync stores cover images in the vault. Leave it blank to use `SirajHub/Covers`. When the folder changes, the next sync copies cached covers to the new folder and updates links in synced notes. The original files stay available to other notes that link to them.
