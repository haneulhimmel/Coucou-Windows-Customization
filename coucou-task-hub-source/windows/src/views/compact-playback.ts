import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Hub, type MediaSession } from "../core/hub";
import { compactMediaControl, type PlaybackAction } from "../core/media-controls";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

/** Stable controls: timer ticks and native media events cannot replace a pressed button. */
export class CompactPlayback {
  private media: MediaSession | null = null;
  private busy = false;
  private iconKey = "";
  private title = h("span", { class: "hub-compact-title" });
  private status = h("span", { class: "hub-compact-media-status" });
  private previous = this.button("previous", "np-icon", t("Previous track"), ICONS.backward);
  private play = this.button("toggle", "np-play", t("Play"), ICONS.play);
  private next = this.button("next", "np-icon", t("Next track"), ICONS.forward);
  readonly el = h("div", { class: "hub-compact-playback" },
    h("div", { class: "hub-compact-copy" }, this.title, this.status),
    h("div", { class: "hub-compact-controls", role: "group", "aria-label": "Playback controls" }, this.previous, this.play, this.next));

  constructor() {
    this.el.querySelector(".hub-compact-controls")!.addEventListener("mousedown", e => {
      e.stopPropagation();
      Sound.resume();
      State.lastActivity = performance.now();
    });
  }

  private button(action: PlaybackAction, className: string, label: string, icon: string) {
    return h("button", { class: className, type: "button", "aria-label": label, onclick: async e => {
      e.stopPropagation();
      if (this.busy || !this.media) return;
      const id = this.media.id;
      this.busy = true;
      this.sync(this.media);
      try { await compactMediaControl(Hub, id, action); }
      finally {
        this.busy = false;
        this.sync(Hub.media.sessions.find(s => s.id === this.media?.id) ?? null);
      }
    } }, svg(icon, action === "toggle" ? 9 : 11));
  }

  sync(media: MediaSession | null) {
    this.media = media;
    this.title.textContent = media?.title || media?.app || "";
    this.title.title = [media?.title, media?.artist].filter(Boolean).join(" — ");
    this.status.textContent = media ? media.playing ? t("Playing") : t("Paused") : "";
    const key = String(media?.playing);
    if (key !== this.iconKey) {
      this.iconKey = key;
      const icon = svg(media?.playing ? ICONS.pause : ICONS.play, 9);
      if (!media?.playing) icon.style.transform = "translateX(1px)";
      this.play.replaceChildren(icon);
    }
    const label = media?.playing ? t("Pause") : t("Play");
    this.play.setAttribute("aria-label", `${label} playback`);
    this.play.title = label;
    this.previous.disabled = this.busy || !media?.canPrevious;
    this.next.disabled = this.busy || !media?.canNext;
    this.play.disabled = this.busy || !(media?.playing ? media.canPause : media?.canPlay);
  }
}
