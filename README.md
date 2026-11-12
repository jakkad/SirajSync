# Siraj Sync

Siraj Sync brings your SirajHub library into Obsidian as Markdown notes with properties. It syncs edits to mapped item fields in both directions. Books, movies, TV shows, podcasts, YouTube videos, articles, and tweets each have their own folder and property mapping.

## Install and connect

1. Use Obsidian 1.11.5 or newer. Create `.obsidian/plugins/siraj-sync/` inside your vault and unzip the release into that folder. Both `manifest.json` and `main.js` should be directly inside it. Reload Obsidian and enable **Siraj Sync** under **Settings → Community plugins**.
2. On a SirajHub server that includes the sync update, sign in and go to **Settings → API Keys → Obsidian sync keys → Generate sync key**. Copy the key when it is displayed. You can revoke it from the same card.
3. In Obsidian, go to **Settings → Siraj Sync**. Enter the site origin (e.g. `https://siraj.example.com`) and use **Link…** to create or select a secret with the copied key. Click **Test connection**, then **Save settings**. Obsidian stores the key in [Secret Storage](https://docs.obsidian.md/plugins/guides/secret-storage).
4. Run **Siraj Sync: Sync now** from the command palette. To sync periodically while Obsidian is open, set a nonzero sync interval.

Under **Statuses to sync**, select one or more statuses and click **Save settings**. All four statuses are selected by default. Sync uses each item's current SirajHub status to decide which notes to import or update. When an item moves to an excluded status, its linked note stays in the vault and sync resumes if the item returns to a selected status. You can still publish an individual note with the **Publish current note to SirajHub** command.

## Folders and properties

Expand each content type in the plugin settings to set its vault folder and map one SirajHub field per line:

```text
title = title
creator = author
rating = my-rating
pageCount = pages
metadata.isbn = isbn
```

Clear a folder to skip that content type. Folder changes apply to future imports; existing linked files stay where you move them. Keep the generated `sirajhub-id` and `sirajhub-account` properties so the plugin can find a linked note after a move or rename.

- Editable fields: `title`, `creator`, `status`, `rating`, `description`, `sourceUrl`, `coverUrl`, `releaseDate`, `externalId`, `notes`, `durationMins`, and `pageCount` (books only). Ratings run from 1 to 7. Status values are `suggestions`, `in_progress`, `finished`, and `archived`.
- Import fields: `metadata.<field>` (for example, `metadata.genres` or `metadata.seasons`), `contentType`, `subtitle`, `progressPercent`, `progressCurrent`, `progressTotal`, `createdAt`, `updatedAt`, `startedAt`, `finishedAt`, and `lastTouchedAt`. Nested objects are represented as JSON strings.
- Only mapped properties participate in sync. The note body stays local. If you want to share commentary, use the property mapped to `notes`. Standalone SirajHub note entries, lists, tags, reminders, and attachments are outside this integration.

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
