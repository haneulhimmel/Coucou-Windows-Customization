import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Hub, clock, mediaPosition, timerRemaining, type Activity } from "../core/hub";
import { Bridge, IS_TAURI } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

function button(label: string, action: () => void, className = "hub-button") {
  return h("button", { class: className, text: label, onclick: action });
}
const symbol = (kind: Activity["kind"]) => ({ media: "♫", timer: "◷", shortcuts: "↗", agent: "◉" })[kind];

export function buildHub(actions: ViewActions): ViewHost {
  const title = h("div", { class: "hub-title", text: "A little space for your day" });
  const subtitle = h("div", { class: "hub-subtitle" });
  const pin = button("Pin activity", () => Hub.togglePin(), "hub-pin");
  const detail = h("div", { class: "hub-detail" });
  const list = h("div", { class: "hub-activity-list", role: "group", "aria-label": "Activities" });
  const footer = h("div", { class: "hub-footer", "data-kind": "timer" });
  const error = h("div", { class: "hub-error", role: "status", "aria-live": "polite" });
  const el = h("div", { class: "view hub-view" },
    h("div", { class: "hub-heading" }, h("div", {}, title, subtitle), pin),
    h("div", { class: "hub-body" }, detail, list), footer, error);
  let detailKey = "";
  let progress: HTMLInputElement | null = null;
  let elapsed: HTMLElement | null = null;
  let remaining: HTMLElement | null = null;
  let timerClock: HTMLElement | null = null;
  let dragging = false;
  let editMode: "timer" | "shortcut" | null = null;
  let mediaError = "";
  let listKey = "";
  const activityNodes = new Map<string, { el: HTMLButtonElement; title: HTMLElement; subtitle: HTMLElement; dot: HTMLElement }>();
  const announceError = (message: string) => { Hub.error = message; Hub.notify(); };

  async function control(action: string, value?: number) {
    const session = Hub.selectedMedia;
    if (!session) return;
    const result = await Bridge.mediaControl(session.id, action, value);
    if (result !== true) announceError(IS_TAURI ? "This player couldn’t apply that control." : "Playback controls are available in the Windows app.");
    else { Hub.error = ""; void Bridge.mediaRefresh().then(s => { if (s) Hub.updateMedia(s); }); }
  }
  async function openShortcut(target: string) {
    if (!IS_TAURI && /^https?:/.test(target)) { window.open(target, "_blank", "noopener"); return; }
    const result = await Bridge.hubOpenTarget(target);
    if (result !== true) announceError(IS_TAURI ? "Couldn’t open this shortcut. Check its path or install the app." : "App and folder shortcuts work in the Windows app.");
  }
  function openEditor(kind: "timer" | "shortcut") { editMode = kind; detailKey = ""; Hub.notify(); }
  function closeEditor() { editMode = null; detailKey = ""; Hub.notify(); }

  function timerEditor() {
    const name = h("input", { class: "hub-input", placeholder: "Timer name", maxlength: "48", "aria-label": "Timer name", value: "Focus timer" });
    const minutes = h("input", { class: "hub-input", type: "number", min: "1", max: "1440", value: "25", "aria-label": "Duration in minutes" });
    const form = h("form", { class: "hub-form", onsubmit: e => {
      e.preventDefault();
      if (!Hub.startTimer(Number(minutes.value), name.value)) announceError("Choose 1–1440 minutes. You can have up to 8 timers.");
      else closeEditor();
    } }, h("div", { class: "hub-section-label", text: "MAKE TIME FOR SOMETHING" }),
    name, h("label", { class: "hub-duration" }, minutes, "minutes"),
    h("div", { class: "hub-control-row" }, h("button", { class: "hub-button primary", type: "submit", text: "Start timer" }), button(t("Cancel"), closeEditor)));
    detail.append(form);
    window.setTimeout(() => minutes.focus(), 0);
  }
  function shortcutEditor() {
    const name = h("input", { class: "hub-input", placeholder: "Shortcut name", maxlength: "32", "aria-label": "Shortcut name" });
    const target = h("input", { class: "hub-input", placeholder: "URL or full path to an app / folder", "aria-label": "Shortcut target" });
    detail.append(h("form", { class: "hub-form", onsubmit: e => {
      e.preventDefault();
      if (!Hub.addShortcut(name.value, target.value)) announceError("Enter a name and a web URL or absolute path. Up to 8 shortcuts.");
      else closeEditor();
    } }, h("div", { class: "hub-section-label", text: "ONE CLICK AWAY" }), name, target,
    h("div", { class: "hub-control-row" }, h("button", { class: "hub-button primary", type: "submit", text: "Save shortcut" }), button(t("Cancel"), closeEditor))));
    window.setTimeout(() => name.focus(), 0);
  }
  function renderDetail() {
    const media = Hub.selectedMedia;
    const timer = Hub.timers.find(t => `timer:${t.id}` === Hub.focusId);
    const key = editMode ?? (Hub.focusId.startsWith("media:") && media ? JSON.stringify([
      media.id, media.title, media.artist, media.artwork, media.playing,
      media.canPlay, media.canPause, media.canNext, media.canPrevious, media.canSeek,
    ]) : timer ? `${timer.id}:${timer.status}` : `shortcuts:${JSON.stringify(Hub.shortcuts)}`);
    if (key === detailKey) return;
    detailKey = key;
    detail.replaceChildren(); progress = null; elapsed = null; remaining = null; timerClock = null;
    if (editMode === "timer") { timerEditor(); return; }
    if (editMode === "shortcut") { shortcutEditor(); return; }
    if (timer) {
      timerClock = h("div", { class: "hub-timer-clock" });
      detail.append(h("div", { class: "hub-section-label", text: timer.status === "finished" ? "A MOMENT WELL SPENT" : timer.status === "paused" ? "TAKE YOUR TIME" : "STAY IN YOUR FLOW" }),
        timerClock, h("div", { class: "hub-track-artist", text: timer.label }),
        h("div", { class: "hub-control-row" },
          timer.status === "finished" ? button(t("Done"), () => Hub.removeTimer(timer.id), "hub-button primary") :
            button(timer.status === "running" ? t("Pause") : "Resume", () => timer.status === "running" ? Hub.pauseTimer(timer.id) : Hub.resumeTimer(timer.id), "hub-button primary"),
          timer.status !== "finished" ? button("Cancel timer", () => Hub.removeTimer(timer.id)) : null));
    } else if (Hub.focusId.startsWith("media:") && media) {
      const art = media.artwork ? h("img", { class: "hub-art", src: media.artwork, alt: "Album artwork" }) : h("div", { class: "hub-art hub-art-empty", text: "♫" });
      detail.append(h("div", { class: "hub-media-head" }, art, h("div", { class: "hub-track-info" },
        h("div", { class: "hub-section-label", text: media.app }), h("div", { class: "hub-track-title", text: media.title || "Now playing" }),
        h("div", { class: "hub-track-artist", text: media.artist || (media.playing ? t("Playing") : t("Paused")) }))));
      elapsed = h("span"); remaining = h("span");
      progress = h("input", { class: "hub-seek", type: "range", min: "0", max: String(Math.max(1, media.duration)), step: "1", "aria-label": "Playback position",
        disabled: !media.canSeek || media.duration <= 0,
        onpointerdown: () => { dragging = true; }, onpointerup: () => { dragging = false; }, onpointercancel: () => { dragging = false; },
        onchange: () => { const value = Number(progress?.value); dragging = false; void control("seek", value); } });
      detail.append(progress, h("div", { class: "hub-time-row" }, elapsed, remaining));
      const previous = h("button", { class: "np-icon", onclick: () => void control("previous") }, svg(ICONS.backward, 11));
      previous.setAttribute("aria-label", t("Previous track")); previous.disabled = !media.canPrevious;
      const playIcon = svg(media.playing ? ICONS.pause : ICONS.play, 9);
      if (!media.playing) playIcon.style.transform = "translateX(1px)";
      const play = h("button", { class: "np-play", onclick: () => void control(media.playing ? "pause" : "play") }, playIcon);
      play.title = media.playing ? t("Pause") : t("Play");
      play.setAttribute("aria-label", media.playing ? "Pause playback" : t("Play")); play.disabled = media.playing ? !media.canPause : !media.canPlay;
      const next = h("button", { class: "np-icon", onclick: () => void control("next") }, svg(ICONS.forward, 11));
      next.setAttribute("aria-label", t("Next track")); next.disabled = !media.canNext;
      detail.append(h("div", { class: "hub-transport-row" }, previous, play, next));
    } else {
      detail.append(h("div", { class: "hub-section-label", text: "YOUR EVERYDAY ESSENTIALS" }),
        h("div", { class: "hub-shortcuts" }, ...Hub.shortcuts.map(s => h("div", { class: "hub-shortcut-item" },
          button(`${s.label} ↗`, () => void openShortcut(s.target), "hub-shortcut"),
          h("button", { class: "hub-remove", text: "×", title: `Remove ${s.label}`, "aria-label": `Remove ${s.label}`, onclick: () => Hub.removeShortcut(s.id) })))),
        button("+ Add shortcut", () => openEditor("shortcut"), "hub-add"));
      if (!Hub.media.sessions.length) detail.append(h("div", { class: "hub-empty-note", text: "Play music in an app to bring it here." }));
    }
  }
  function tick() {
    const media = Hub.selectedMedia;
    if (media && progress) {
      const at = mediaPosition(media);
      if (!dragging && document.activeElement !== progress) progress.value = String(at);
      if (elapsed) elapsed.textContent = clock(at * 1000);
      if (remaining) remaining.textContent = media.duration > 0 ? `−${clock((media.duration - at) * 1000)}` : "Live";
    }
    const timer = Hub.timers.find(t => `timer:${t.id}` === Hub.focusId);
    if (timerClock && timer) timerClock.textContent = timer.status === "finished" ? "Time’s up" : clock(timerRemaining(timer));
    return !!(timer?.status === "running" || media?.playing);
  }
  return { el, tick, sync() {
    const activity = Hub.activities().find(a => a.id === Hub.focusId);
    title.textContent = Hub.alertId ? "Time for your next moment" : "A little space for your day";
    subtitle.textContent = Hub.alertId ? "Your timer has finished" : "Music, moments, and the things you do";
    pin.textContent = Hub.pinnedId ? "● Pinned" : "Pin activity";
    pin.setAttribute("aria-pressed", String(!!Hub.pinnedId));
    // Keep editor inputs and playback sliders mounted across timer / media events.
    const focusedTimer = Hub.timers.find(t => `timer:${t.id}` === Hub.focusId);
    detail.dataset.kind = editMode === "shortcut" ? "shortcuts" : editMode ?? activity?.kind ?? "shortcuts";
    detail.dataset.status = editMode ? "" : focusedTimer?.status ?? "";
    renderDetail();
    const activities = Hub.activities();
    const nextListKey = `${activities.map(a => a.id).join("|")}:${State.tasks.length > 0}`;
    if (nextListKey !== listKey) {
      listKey = nextListKey; activityNodes.clear(); list.replaceChildren();
      for (const a of activities) {
        const title = h("span", { class: "hub-activity-title" });
        const subtitle = h("span", { class: "hub-activity-sub" });
        const dot = h("i", { class: "hub-live-dot" });
        const el = h("button", { class: "hub-activity", "data-kind": a.kind, onclick: () => { editMode = null; Hub.select(a.id); } },
          h("span", { class: `hub-activity-icon ${a.kind}`, text: symbol(a.kind) }),
          h("span", { class: "hub-activity-copy" }, title, subtitle), dot);
        activityNodes.set(a.id, { el, title, subtitle, dot }); list.append(el);
      }
      if (State.tasks.length) {
        const agentLink = button("AI & connected services ↗", () => actions.setView("overview"), "hub-agent-link");
        agentLink.dataset.kind = "agent";
        list.append(agentLink);
      }
    }
    for (const a of activities) {
      const row = activityNodes.get(a.id)!;
      row.el.classList.toggle("selected", a.id === activity?.id);
      row.el.setAttribute("aria-pressed", String(a.id === activity?.id));
      row.el.setAttribute("aria-label", `${a.title}, ${a.subtitle}`);
      row.el.dataset.status = a.kind === "timer" ? Hub.timers.find(t => `timer:${t.id}` === a.id)?.status ?? "" : "";
      row.title.textContent = a.title; row.subtitle.textContent = a.subtitle;
      row.dot.style.visibility = a.active ? "visible" : "hidden";
    }
    if (!footer.childElementCount) footer.append(h("span", { class: "hub-section-label", text: "MAKE A MOMENT" }),
      ...[5, 15, 25].map(m => button(`${m} min`, () => { if (!Hub.startTimer(m)) announceError("You can have up to 8 timers."); else closeEditor(); }, "hub-preset")),
      button("Custom timer", () => openEditor("timer"), "hub-preset"));
    mediaError = Hub.media.error ?? "";
    error.textContent = Hub.error || Hub.storageError || mediaError;
    tick();
  } };
}
