import { Notice } from "obsidian";

export class SyncProgress {
  private notice?: Notice;
  private timer?: number;
  private detail?: HTMLDivElement;
  private bar?: HTMLProgressElement;
  private step = "Connecting to SirajHub…";
  private checked = 0;
  private total?: number;

  constructor(automatic: boolean) {
    if (automatic) this.timer = window.setTimeout(() => this.show(), 1000);
    else this.show();
  }

  get shown() { return this.notice !== undefined; }

  show() {
    this.cancelTimer();
    this.notice?.hide();
    const content = activeDocument.createDocumentFragment();
    content.createEl("strong", { text: "Siraj Sync" });
    this.detail = content.createDiv();
    this.bar = content.createEl("progress", { attr: { "aria-label": "Siraj Sync item progress" } });
    this.bar.style.width = "100%";
    this.render();
    this.notice = new Notice(content, 0);
  }

  update(step: string, checked = this.checked, total = this.total) {
    this.step = step;
    this.checked = checked;
    this.total = total;
    this.render();
  }

  close() {
    this.cancelTimer();
    this.notice?.hide();
    this.detail = undefined;
    this.bar = undefined;
  }

  private cancelTimer() {
    if (this.timer === undefined) return;
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private render() {
    if (!this.detail || !this.bar) return;
    this.detail.textContent = this.total === undefined ? this.step : `${this.checked} of ${this.total} items checked · ${this.step}`;
    this.bar.hidden = this.total === 0;
    if (this.total !== undefined && this.total > 0) {
      this.bar.max = this.total;
      this.bar.value = this.checked;
    }
  }
}
