import {
  App, getFrontMatterInfo, Modal, Notice, parseYaml, Plugin, PluginSettingTab,
  SecretComponent, Setting, stringifyYaml, TFile, TFolder,
} from "obsidian";
import { SirajApi } from "./api.ts";
import {
  ACCOUNT, cleanFolder, createPayload, defaults, ID, initialProperties, isStatus, isType, KEY,
  parseRules, planItem, serverOrigin, stable, STATUSES, statusIds, TYPES, ULID,
  type Baseline, type ContentType, type Item, type Properties, type Resolution, type Settings,
} from "./model.ts";

type SyncData = { settings: Settings; baselines: Record<string, Baseline> };
type Report = { created: number; pulled: number; pushed: number; unchanged: number; issues: string[] };
const typeIds = Object.keys(TYPES) as ContentType[];

function frontmatterBlock(text: string) {
  const offset = text.startsWith("\uFEFF") ? 1 : 0;
  const block = getFrontMatterInfo(text.slice(offset));
  return { ...block, contentStart: block.contentStart + offset };
}

function properties(text: string): Properties {
  const block = frontmatterBlock(text);
  if (!block.exists) {
    if (/^\uFEFF?---[ \t]*\r?\n/.test(text)) throw Error("The frontmatter block is missing its closing delimiter.");
    return {};
  }
  const parsed: unknown = parseYaml(block.frontmatter);
  if (parsed == null) return {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed instanceof Date) {
    throw Error("Note properties must be a YAML mapping.");
  }
  return parsed as Properties;
}

function withProperties(text: string, props: Properties): string {
  const block = frontmatterBlock(text);
  const body = text.slice(block.contentStart);
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const frontmatter = `---\n${stringifyYaml(props).trimEnd()}\n---\n`.replaceAll("\n", newline);
  return bom + frontmatter + body;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error.";
}

function safeFilename(title: string) {
  return title.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, "-").replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 64).replace(/[. ]+$/g, "") || "SirajHub item";
}

export default class SirajSync extends Plugin {
  data!: SyncData;
  private saving: Promise<void> = Promise.resolve();
  private running = false;
  private ready = false;
  private loaded = false;
  private lastAutomatic = Date.now();
  private report?: Report;

  async onload() {
    const stored = await this.loadData() as Partial<SyncData> | null;
    const base = defaults();
    this.data = {
      settings: { ...base, ...stored?.settings, types: { ...base.types, ...stored?.settings?.types } },
      baselines: stored?.baselines ?? {},
    };
    this.loaded = true;
    this.addSettingTab(new SyncSettings(this.app, this));
    this.addCommand({ id: "sync-now", name: "Sync now", callback: () => void this.sync() });
    this.addCommand({ id: "publish-note", name: "Publish current note to SirajHub", callback: () => void this.publish() });
    this.addCommand({ id: "show-report", name: "Show last sync report", callback: () => this.showReport() });
    this.addCommand({ id: "use-hub-values", name: "Resolve current note using SirajHub values", callback: () => void this.resolve("pull") });
    this.addCommand({ id: "use-note-values", name: "Resolve current note using Obsidian values", callback: () => void this.resolve("push") });
    this.app.workspace.onLayoutReady(() => { this.ready = this.loaded; });
    this.registerInterval(window.setInterval(() => {
      const { interval, secret, server } = this.data.settings;
      if (this.ready && interval > 0 && secret && server && Date.now() - this.lastAutomatic >= interval * 60_000) {
        this.lastAutomatic = Date.now();
        void this.sync(true);
      }
    }, 30_000));
  }

  onunload() { this.loaded = false; }

  private save() {
    const snapshot = structuredClone(this.data);
    const task = this.saving.catch(() => undefined).then(() => this.saveData(snapshot));
    this.saving = task;
    return task;
  }

  async updateSettings(next: Settings) {
    if (this.running) throw Error("Wait for the current sync to finish before saving settings.");
    if (!next.statuses.length) throw Error("Select at least one status to sync.");
    if (next.server) this.connectionOrigin(next);
    this.data.settings = next;
    this.lastAutomatic = Date.now();
    await this.save();
  }

  private connectionOrigin(settings: Pick<Settings, "server" | "secret">) {
    const origin = serverOrigin(settings.server);
    const current = this.data.settings;
    if (current.server && origin !== current.server && settings.secret && settings.secret === current.secret) {
      throw Error("Select a different Obsidian secret when switching SirajHub servers.");
    }
    return origin;
  }

  private api(settings: Pick<Settings, "server" | "secret">) {
    const origin = this.connectionOrigin(settings);
    if (!settings.secret) throw Error("Use Link… under Sync key to select your SirajHub key.");
    const key = this.app.secretStorage.getSecret(settings.secret)?.trim();
    if (!key || !KEY.test(key)) throw Error("The linked secret must contain a sync key generated by SirajHub.");
    return new SirajApi(origin, key);
  }

  async checkConnection(settings: Pick<Settings, "server" | "secret">) {
    await this.api(settings).account();
  }

  private async run(operation: (settings: Settings) => Promise<void>, quiet = false) {
    if (this.running) { if (!quiet) new Notice("Siraj Sync: a sync is already running."); return; }
    this.running = true;
    try {
      await operation(structuredClone(this.data.settings));
    } catch (error) {
      new Notice(`Siraj Sync: ${message(error)}`, 8000);
    } finally {
      this.running = false;
    }
  }

  private async linkedNotes(account: string) {
    const found = new Map<string, TFile[]>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.loaded) break;
      const raw = await this.app.vault.cachedRead(file);
      const frontmatter = frontmatterBlock(raw);
      if (!frontmatter.frontmatter.includes(ID)) {
        if (!frontmatter.exists && /^\uFEFF?---[ \t]*\r?\n/.test(raw) && raw.includes(ID)) {
          throw Error(`${file.path}: close the frontmatter block before syncing.`);
        }
        continue;
      }
      let props: Properties;
      try { props = properties(raw); } catch {
        throw Error(`${file.path}: fix the YAML properties before syncing.`);
      }
      if (props[ACCOUNT] !== account) continue;
      const id = props[ID];
      if (typeof id !== "string" || !ULID.test(id)) {
        throw Error(`${file.path}: the SirajHub item ID is invalid.`);
      }
      const paths = found.get(id) ?? [];
      paths.push(file);
      found.set(id, paths);
    }
    return found;
  }

  private async ensureFolder(folder: string) {
    let path = "";
    for (const segment of folder.split("/")) {
      path = path ? `${path}/${segment}` : segment;
      const entry = this.app.vault.getAbstractFileByPath(path);
      if (entry instanceof TFolder) continue;
      if (entry) throw Error(`${path} is a file. Choose a different folder.`);
      await this.app.vault.createFolder(path);
    }
  }

  private async importItem(item: Item, account: string, config: Settings["types"][ContentType]) {
    const rules = parseRules(config.properties, item.contentType);
    const props = { [ID]: item.id, [ACCOUNT]: account, ...initialProperties(item, rules) };
    await this.ensureFolder(config.folder);
    const base = `${config.folder}/${safeFilename(item.title)} (${item.id})`;
    let path = `${base}.md`;
    for (let suffix = 2; this.app.vault.getAbstractFileByPath(path); suffix++) {
      path = `${base} ${suffix}.md`;
    }
    await this.app.vault.create(path, withProperties("", props));
    const { next } = await planItem(item, props, rules, {});
    this.data.baselines[`${account}/${item.id}`] = next;
  }

  private async reconcile(
    api: SirajApi, file: TFile, item: Item, account: string, config: Settings["types"][ContentType], result: Report,
    resolution: Resolution = "normal",
  ) {
    const rules = parseRules(config.properties, item.contentType);
    const raw = await this.app.vault.read(file);
    const local = properties(raw);
    if (local[ID] !== item.id || local[ACCOUNT] !== account) throw Error("This note’s SirajHub link changed.");
    const key = `${account}/${item.id}`;
    const previous = this.data.baselines[key] ?? {};
    let plan = await planItem(item, local, rules, previous, resolution);
    let wrote = false;

    if (Object.keys(plan.writes).length && this.loaded) {
      // Avoid sending a stale local snapshot if the note changed while we calculated the plan.
      if (await this.app.vault.read(file) !== raw) throw Error("The note changed during sync. Run sync again.");
      const payload = plan.writes;
      const updated = await api.patch(item, payload);
      result.pushed++;
      wrote = true;
      plan = await planItem(updated, local, rules, previous, resolution, payload);
    }

    if (Object.keys(plan.pulls).length && this.loaded) {
      let changed = false;
      await this.app.vault.process(file, (current) => {
        if (current !== raw) throw Error("The note changed during sync. Run sync again.");
        const next = { ...local };
        for (const [property, value] of Object.entries(plan.pulls)) {
          if (value == null) delete next[property];
          else next[property] = value;
        }
        changed = true;
        return withProperties(current, next);
      });
      if (changed) result.pulled++;
    } else if (!wrote && !plan.problems.length) {
      result.unchanged++;
    }
    for (const problem of plan.problems) result.issues.push(`${file.path}: ${problem}`);
    this.data.baselines[key] = plan.next;
  }

  async sync(automatic = false, only?: TFile, resolution: Resolution = "normal") {
    await this.run(async (settings) => {
      this.lastAutomatic = Date.now();
      const api = this.api(settings);
      const account = await api.account();
      const [items, links] = await Promise.all([api.items(), this.linkedNotes(account)]);
      const result: Report = { created: 0, pulled: 0, pushed: 0, unchanged: 0, issues: [] };
      const remoteIds = new Set(items.map(({ id }) => id));

      for (const item of items) {
        if (!this.loaded) break;
        const config = settings.types[item.contentType];
        const notes = links.get(item.id) ?? [];
        if (only && !notes.includes(only)) continue;
        if (!isStatus(item.status) || !settings.statuses.includes(item.status)) {
          if (only) result.issues.push(`${only.path}: the item's SirajHub status is not selected for sync.`);
          continue;
        }
        if (!config.folder) {
          if (only) result.issues.push(`${only.path}: sync is disabled for ${TYPES[item.contentType]}.`);
          continue;
        }
        try {
          if (notes.length > 1) throw Error(`More than one note links to this item: ${notes.map((file) => file.path).join(", ")}.`);
          if (notes[0]) await this.reconcile(api, notes[0], item, account, config, result, resolution);
          else {
            await this.importItem(item, account, config);
            result.created++;
          }
        } catch (error) {
          result.issues.push(`${item.title}: ${message(error)}`);
        }
      }
      for (const [id, files] of links) {
        if (!remoteIds.has(id) && (!only || files.includes(only))) {
          result.issues.push(`${files.map((file) => file.path).join(", ")}: item no longer exists in SirajHub; note kept.`);
        }
      }
      if (only && ![...links.values()].some((files) => files.includes(only))) {
        result.issues.push(`${only.path}: this note isn’t linked to the connected SirajHub account.`);
      }
      this.report = result;
      await this.save();
      if (!automatic || result.issues.length) {
        new Notice(`Siraj Sync: ${this.summary(result)}${result.issues.length ? " Run “Show last sync report” for details." : ""}`, 8000);
      }
    }, automatic);
  }

  private summary(result: Report) {
    return `${result.created} imported, ${result.pulled} updated in Obsidian, ${result.pushed} sent to SirajHub, ${result.unchanged} unchanged, ${result.issues.length} to review.`;
  }

  private showReport() {
    const report = this.report;
    if (!report) { new Notice("Siraj Sync: run a sync first."); return; }
    const modal = new Modal(this.app);
    modal.setTitle("Siraj Sync report");
    modal.contentEl.createEl("p", { text: this.summary(report) });
    if (report.issues.length) {
      const list = modal.contentEl.createEl("ul");
      report.issues.forEach((issue) => list.createEl("li", { text: issue }));
    }
    modal.open();
  }

  private confirm(title: string, detail: string, action: string, callback: () => void) {
    const modal = new Modal(this.app);
    modal.setTitle(title);
    modal.contentEl.createEl("p", { text: detail });
    new Setting(modal.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => modal.close()))
      .addButton((button) => button.setButtonText(action).setCta().onClick(() => { modal.close(); callback(); }));
    modal.open();
  }

  private async resolve(direction: "pull" | "push") {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice("Siraj Sync: open a linked Markdown note."); return; }
    const pull = direction === "pull";
    this.confirm(pull ? "Use SirajHub values?" : "Use Obsidian values?",
      pull ? `SirajHub values will replace differing mapped properties in ${file.name}.`
        : `Editable properties in ${file.name} will take precedence when both copies changed.`,
      pull ? "Use SirajHub values" : "Use Obsidian values", () => void this.sync(false, file, direction));
  }

  private async publish() {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") { new Notice("Siraj Sync: open a Markdown note to publish."); return; }
    try {
      const settings = structuredClone(this.data.settings);
      const path = file.path;
      const config = typeIds.filter((type) => {
        const folder = settings.types[type].folder;
        return folder && path.startsWith(`${folder}/`);
      }).sort((a, b) => settings.types[b].folder.length - settings.types[a].folder.length);
      const type = config[0];
      if (!isType(type)) throw Error("Move this note into a configured SirajHub folder first.");
      if (config[1] && settings.types[type].folder === settings.types[config[1]].folder) {
        throw Error("This folder maps to multiple types. Use a unique folder to publish this note.");
      }
      const raw = await this.app.vault.read(file);
      const local = properties(raw);
      if (Object.hasOwn(local, ID) || Object.hasOwn(local, ACCOUNT)) throw Error("This note already has a SirajHub link.");
      const rules = parseRules(settings.types[type].properties, type);
      const payload = createPayload(type, local, rules, file.basename);
      const fieldNames = Object.keys(payload).filter((field) => field !== "contentType").join(", ");
      this.confirm("Publish note to SirajHub?",
        `Create “${String(payload.title)}” in ${TYPES[type]}. Fields sent: ${fieldNames}.`,
        "Publish", () => void this.run(async (current) => {
          if (stable(settings) !== stable(current) || file.path !== path || await this.app.vault.read(file) !== raw) {
            throw Error("The note or settings changed. Review the note and run Publish again.");
          }
          const api = this.api(settings);
          const account = await api.account();
          const item = await api.create(payload);
          const remote = initialProperties(item, rules);
          try {
            await this.app.vault.process(file, (content) => {
              const live = properties(content);
              if (Object.hasOwn(live, ID) || Object.hasOwn(live, ACCOUNT)) throw Error("This note is already linked.");
              const merged = { ...live, [ID]: item.id, [ACCOUNT]: account } as Properties;
              for (const { property, writable } of rules) {
                // Preserve local edits made during the request and pre-existing values for read-only fields.
                if (stable(live[property]) !== stable(local[property]) || (!writable && Object.hasOwn(live, property))) continue;
                if (Object.hasOwn(remote, property)) merged[property] = remote[property];
                else delete merged[property];
              }
              return withProperties(content, merged);
            });
          } catch {
            throw Error(`The item was created in SirajHub (ID ${item.id}), but the note could not be linked. Review it on the site before publishing again.`);
          }
          const { next } = await planItem(item, remote, rules, {});
          this.data.baselines[`${account}/${item.id}`] = next;
          await this.save();
          new Notice("Siraj Sync: note published and linked.");
        }));
    } catch (error) { new Notice(`Siraj Sync: ${message(error)}`, 8000); }
  }
}

class SyncSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SirajSync) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const draft = structuredClone(this.plugin.data.settings);
    new Setting(containerEl).setName("Connection").setHeading();
    new Setting(containerEl).setName("SirajHub URL").setDesc("The site origin, for example https://siraj.example.com.")
      .addText((input) => input.setPlaceholder("https://siraj.example.com").setValue(draft.server)
        .onChange((value) => { draft.server = value; }));
    new Setting(containerEl).setName("Sync key").setDesc("Generate a key under SirajHub → Settings → API Keys, then create or select an Obsidian secret.")
      .addComponent((el) => new SecretComponent(this.app, el).setValue(draft.secret)
        .onChange((value) => { draft.secret = value ?? ""; }));
    new Setting(containerEl).setName("Check connection").setDesc("Tests the URL and sync key above. Use Save settings to apply your changes.")
      .addButton((button) => button.setButtonText("Test connection").onClick(async () => {
        button.setDisabled(true);
        connectionStatus.setText("Connecting to SirajHub…");
        try {
          await this.plugin.checkConnection({ server: draft.server, secret: draft.secret });
          connectionStatus.setText("Connected to SirajHub.");
        } catch (error) {
          connectionStatus.setText(message(error));
        } finally {
          button.setDisabled(false);
        }
      }));
    const connectionStatus = containerEl.createEl("div", { attr: { role: "status" } });
    let minutes = String(draft.interval);
    new Setting(containerEl).setName("Sync interval in minutes").setDesc("Enter 0 for manual sync only. Automatic sync runs while Obsidian is open.")
      .addText((input) => input.setValue(minutes).onChange((value) => { minutes = value; }));

    new Setting(containerEl).setName("Statuses to sync").setHeading();
    containerEl.createEl("p", { text: "Select at least one SirajHub status. Items with other statuses are skipped, and their existing notes stay in your vault." });
    const selectedStatuses = new Set(draft.statuses);
    for (const status of statusIds) {
      new Setting(containerEl).setName(STATUSES[status])
        .addToggle((toggle) => toggle.setValue(selectedStatuses.has(status)).onChange((enabled) => {
          if (enabled) selectedStatuses.add(status);
          else selectedStatuses.delete(status);
        }));
    }

    new Setting(containerEl).setName("Library folders and properties").setHeading();
    containerEl.createEl("p", { text: "Clear a folder to skip that type. Use one field = property mapping per line. Fields starting with metadata. are imported from SirajHub. Changes to folders affect new imports; linked notes stay where you put them." });
    for (const type of typeIds) {
      const details = containerEl.createEl("details");
      details.createEl("summary", { text: TYPES[type] });
      const config = draft.types[type];
      new Setting(details).setName("Folder").addText((input) => input.setValue(config.folder)
        .onChange((value) => { config.folder = value; }));
      new Setting(details).setName("Property mappings").addTextArea((input) => {
        input.inputEl.rows = 9;
        input.inputEl.cols = 32;
        input.setValue(config.properties).onChange((value) => { config.properties = value; });
      });
    }
    const status = containerEl.createEl("p", { attr: { role: "status" } });
    new Setting(containerEl)
      .addButton((button) => button.setButtonText("Save settings").setCta().onClick(async () => {
        status.setText("");
        try {
          const interval = Number(minutes);
          if (!/^\d+$/.test(minutes.trim()) || !Number.isInteger(interval) || interval > 1440) {
            throw Error("Enter a whole number from 0 to 1440 minutes.");
          }
          const next = structuredClone(draft);
          next.interval = interval;
          next.statuses = statusIds.filter((status) => selectedStatuses.has(status));
          next.server = draft.server.trim() ? serverOrigin(draft.server) : "";
          for (const type of typeIds) {
            try {
              next.types[type].folder = cleanFolder(next.types[type].folder);
              parseRules(next.types[type].properties, type);
            } catch (error) { throw Error(`${TYPES[type]}: ${message(error)}`); }
          }
          await this.plugin.updateSettings(next);
          status.setText("Settings saved.");
        } catch (error) { status.setText(message(error)); }
      }));
  }
}
