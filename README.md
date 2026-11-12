# Siraj Sync

Siraj Sync brings your SirajHub library into Obsidian as Markdown notes with properties. It syncs edits to mapped item fields in both directions. Books, movies, TV shows, podcasts, YouTube videos, articles, and tweets each have their own folder and property mapping.

## Install and connect

1. Use Obsidian 1.11.5 or newer. Create `.obsidian/plugins/siraj-sync/` inside your vault and unzip the release into that folder. Both `manifest.json` and `main.js` should be directly inside it. Reload Obsidian and enable **Siraj Sync** under **Settings → Community plugins**.
2. On a SirajHub server that includes the sync update, sign in and go to **Settings → API Keys → Obsidian sync keys → Generate sync key**. Copy the key when it is displayed. You can revoke it from the same card.
3. In Obsidian, go to **Settings → Siraj Sync**. Enter the site origin (e.g. `https://siraj.example.com`) and use **Link…** to create or select a secret with the copied key. Click **Test connection**, then **Save settings**. Obsidian stores the key in [Secret Storage](https://docs.obsidian.md/plugins/guides/secret-storage).
4. Run **Siraj Sync: Sync now** from the command palette. To sync periodically while Obsidian is open, set a nonzero sync interval.

The progress notice shows how many items sync has checked and which cover it is downloading. It appears immediately for manual sync and after one second for automatic sync. If you dismiss it, run **Siraj Sync: Show sync progress** from the command palette to reopen it.

Under **Statuses to sync**, select one or more statuses and click **Save settings**. All four statuses are selected by default. Sync uses each item's current SirajHub status to decide which notes to import or update. When an item moves to an excluded status, its linked note stays in the vault and sync resumes if the item returns to a selected status. You can still publish an individual note with the **Publish current note to SirajHub** command.

## Folders and properties

Expand each content type in the plugin settings to set its vault folder and map one SirajHub field per line:

```text
title = title
creator = [[author]]
finishedAt = finished-date
rating = my-rating
pageCount = pages
metadata.isbn = isbn
```

Wrap the property name in double brackets to make its text values Obsidian links. For example, `creator = [[author]]` writes `author: "[[Ursula K. Le Guin]]"`. Existing synced values change format on the next sync. Editing a linked value sends the link target text or its alias to SirajHub as plain text. The plugin writes links to note names, and you can create missing target notes from Obsidian.

Add `finishedAt = finished-date` to an existing mapping to import the date from SirajHub. It uses the same `YYYY-MM-DD` date as the SirajHub edit form. In Obsidian, set the property type to **Date** for the calendar picker and date comparisons. New default mappings already include it.

Set **Covers folder** to choose where sync stores covers inside your vault. The default is `SirajHub/Covers`, with a subfolder for each connected account. After you change the folder, sync copies cached covers to the new location and keeps the old copies for any other notes that link to them. Sync retries missing images by default. Turn on **Redownload covers on every sync** to refresh existing files. With `coverUrl = cover`, sync updates the `cover` property to link to the local file. If a local copy is unavailable, it uses the source URL. Existing `coverImage` mappings continue to work as local file links.

Clear a folder to skip that content type. Folder changes apply to future imports. Move or rename linked notes in Obsidian with Siraj Sync enabled so it can update the stored paths. When an older note syncs, the plugin moves its link into plugin data, removes the two sync properties, and strips the old item ID suffix from its filename.

Enable **Remove properties when mappings are removed** to apply mapping removals to existing linked notes on the next sync. For example, removing `status = siraj-status` deletes the previously synced `siraj-status` property. Cleanup also applies to linked notes for excluded statuses and disabled content types. It uses each note’s recorded sync history, so it can only remove properties the plugin still has a record of syncing.

- Editable fields: `title`, `creator`, `status`, `rating`, `description`, `sourceUrl`, `coverUrl`, `releaseDate`, `externalId`, `notes`, `durationMins`, and `pageCount` (books only). Ratings run from 1 to 7. Status values are `suggestions`, `in_progress`, `finished`, and `archived`.
- Import fields: `metadata.<field>` (for example, `metadata.genres` or `metadata.seasons`), `contentType`, `subtitle`, `progressPercent`, `progressCurrent`, `progressTotal`, `createdAt`, `updatedAt`, `startedAt`, `finishedAt`, and `lastTouchedAt`. Nested objects are represented as JSON strings.
- Only mapped properties participate in two-way sync. If you want to share commentary, use the property mapped to `notes`. Standalone SirajHub note entries, lists, tags, reminders, and attachments are outside this integration.

Use **Note body template** under a content type to insert SirajHub fields into a Markdown section in the note body. The template can use fields that have no property mapping.

```markdown
## About this book

**Author:** {{creator}}
**Genres:** {{metadata.genres}}

{{description}}
```

Sync refreshes the generated section with SirajHub values. Write personal notes outside that section. Clear the template to remove the generated section on the next sync.

To create an item from Obsidian, put the Markdown file in a folder mapped to one content type and run **Siraj Sync: Publish current note to SirajHub**. Review the fields in the confirmation. After publishing, the note is linked to the new item. Unlinked notes are never uploaded in bulk.

Edits to different fields merge. If the same field changes on both sides, **Siraj Sync: Show last sync report** lists the conflict. Reconcile the values manually, or open the affected note and use one of the **Resolve current note** commands. Deletions are not propagated: a note is kept if its SirajHub item disappears, and an item that still exists on SirajHub will be reimported if its Obsidian note is deleted.

## Development

Use Node.js 22 or newer:

```sh
npm ci
npm test
npm run build
```

The build writes `main.js` beside `manifest.json`. See the [SirajHub update](sirajhub-obsidian-sync.patch) for the server changes, including migration `0014_obsidian_sync_keys.sql`. Apply the migration through the normal SirajHub release process before using the live integration.
