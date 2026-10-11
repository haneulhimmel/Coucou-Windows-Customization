/** Everyday activities, independent of the optional coding-agent state. */
export interface MediaSession {
  id: string;
  app: string;
  title: string;
  artist: string;
  artwork: string | null;
  playing: boolean;
  position: number;
  duration: number;
  sampledAt: number;
  canPlay: boolean;
  canPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
}
export interface MediaSnapshot { sessions: MediaSession[]; currentId: string | null; error?: string | null }
export interface HubTimer {
  id: string; label: string; durationMs: number; remainingMs: number;
  deadline: number | null; status: "running" | "paused" | "finished";
}
export interface HubShortcut { id: string; label: string; target: string }
export type ActivityKind = "media" | "timer" | "shortcuts" | "agent";
export interface Activity { id: string; kind: ActivityKind; title: string; subtitle: string; active: boolean }
export interface HubStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const STORAGE_KEY = "coucou.task-hub.v1";
const DEFAULT_SHORTCUTS: HubShortcut[] = [
  { id: "spotify", label: "Spotify", target: "spotify:" },
  { id: "music", label: "Music", target: "https://music.apple.com/" },
  { id: "files", label: "Files", target: "shell:Personal" },
];

export function timerRemaining(timer: HubTimer, now = Date.now()): number {
  return Math.max(0, timer.deadline == null ? timer.remainingMs : timer.deadline - now);
}
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
export function mediaPosition(media: MediaSession, now = Date.now()): number {
  const p = media.position + (media.playing ? Math.max(0, now - media.sampledAt) / 1000 : 0);
  return media.duration > 0 ? Math.min(media.duration, p) : p;
}
/** Supported protocols or an absolute local path; no command strings. */
export function validShortcutTarget(target: string): boolean {
  return target.length <= 2048 && !/[\r\n\0]/.test(target) &&
    (/^https?:\/\/[^\s]+$/i.test(target) || /^spotify:(?:[a-zA-Z0-9:]+)?$/.test(target) ||
      /^shell:(Personal|Downloads|Desktop)$/.test(target) || /^[A-Za-z]:[\\/]/.test(target));
}

export class ActivityHub {
  media: MediaSnapshot = { sessions: [], currentId: null };
  timers: HubTimer[] = [];
  shortcuts: HubShortcut[] = DEFAULT_SHORTCUTS.map(s => ({ ...s }));
  selectedId: string | null = null;
  pinnedId: string | null = null;
  alertId: string | null = null;
  error = "";
  storageError = "";
  private beforeAlert: string | null = null;
  private listeners = new Set<() => void>();
  private storage: HubStorage | null = null;
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) fn(); }

  load(storage: HubStorage) {
    this.storage = storage;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.timers)) this.timers = data.timers.filter((v: HubTimer) =>
        v && typeof v.id === "string" && typeof v.label === "string" &&
        Number.isFinite(v.durationMs) && v.durationMs > 0 && v.durationMs <= 86_400_000 &&
        Number.isFinite(v.remainingMs) && v.remainingMs >= 0 &&
        (v.deadline === null || Number.isFinite(v.deadline)) &&
        ["running", "paused", "finished"].includes(v.status) &&
        ((v.status === "running") === (v.deadline !== null))).slice(0, 8);
      if (Array.isArray(data.shortcuts)) this.shortcuts = data.shortcuts.filter((v: HubShortcut) =>
        v && typeof v.id === "string" && typeof v.label === "string" && typeof v.target === "string" &&
        validShortcutTarget(v.target)).slice(0, 8);
      this.pinnedId = typeof data.pinnedId === "string" ? data.pinnedId : null;
      // Finished, unacknowledged timers stay actionable after reopening the app.
      const finished = this.timers.find(t => t.status === "finished");
      if (finished) this.alertId = `timer:${finished.id}`;
    } catch { this.storageError = "Saved activities could not be read."; }
  }
  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ timers: this.timers, shortcuts: this.shortcuts, pinnedId: this.pinnedId }));
      this.storageError = "";
    } catch { this.storageError = "Activities could not be saved. Keep the app open for your timers."; }
  }
  updateMedia(snapshot: MediaSnapshot) {
    this.media = snapshot;
    this.notify();
  }
  get selectedMedia() {
    const id = this.focusId;
    return this.media.sessions.find(s => `media:${s.id}` === id) ??
      this.media.sessions.find(s => s.id === this.media.currentId) ?? this.media.sessions[0] ?? null;
  }
  activities(now = Date.now()): Activity[] {
    return [
      ...this.timers.map(t => ({ id: `timer:${t.id}`, kind: "timer" as const, title: t.label,
        subtitle: t.status === "finished" ? "Time’s up" : `${clock(timerRemaining(t, now))}${t.status === "paused" ? " · Paused" : " remaining"}`,
        active: t.status !== "paused" })),
      ...this.media.sessions.map(s => ({ id: `media:${s.id}`, kind: "media" as const,
        title: s.title || s.app, subtitle: s.artist || s.app, active: s.playing })),
      { id: "shortcuts", kind: "shortcuts" as const, title: "Your shortcuts", subtitle: "A little less switching", active: false },
    ];
  }
  get focusId(): string {
    const items = this.activities();
    for (const id of [this.alertId, this.pinnedId, this.selectedId]) if (id && items.some(a => a.id === id)) return id;
    const timer = this.timers.find(t => t.status === "running");
    if (timer) return `timer:${timer.id}`;
    const media = this.media.sessions.find(s => s.playing && s.id === this.media.currentId) ?? this.media.sessions.find(s => s.playing);
    return media ? `media:${media.id}` : "shortcuts";
  }
  select(id: string) { this.error = ""; this.selectedId = id; if (this.pinnedId) this.pinnedId = id; this.save(); this.notify(); }
  togglePin() { this.pinnedId = this.pinnedId ? null : this.focusId; this.save(); this.notify(); }
  get hasLiveActivity() { return this.timers.length > 0 || this.media.sessions.length > 0; }
  get musicPlaying() { return this.media.sessions.some(s => s.playing); }
  startTimer(minutes: number, label = "Focus timer", now = Date.now()): HubTimer | null {
    if (!Number.isFinite(minutes) || minutes < 1 / 60 || minutes > 1440 || this.timers.length >= 8) return null;
    const durationMs = Math.round(minutes * 60_000);
    const timer: HubTimer = { id: crypto.randomUUID(), label: label.trim().slice(0, 48) || "Timer", durationMs,
      remainingMs: durationMs, deadline: now + durationMs, status: "running" };
    this.error = ""; this.timers.push(timer); this.selectedId = `timer:${timer.id}`;
    if (this.pinnedId) this.pinnedId = this.selectedId;
    this.save(); this.notify(); return timer;
  }
  pauseTimer(id: string, now = Date.now()) {
    const timer = this.timers.find(t => t.id === id);
    if (!timer || timer.status !== "running") return;
    if (timerRemaining(timer, now) === 0) { this.tick(now); return; }
    timer.remainingMs = timerRemaining(timer, now); timer.deadline = null; timer.status = "paused";
    this.save(); this.notify();
  }
  resumeTimer(id: string, now = Date.now()) {
    const timer = this.timers.find(t => t.id === id);
    if (!timer || timer.status !== "paused") return;
    timer.deadline = now + timer.remainingMs; timer.status = "running"; this.save(); this.notify();
  }
  removeTimer(id: string) {
    this.error = "";
    const activityId = `timer:${id}`;
    this.timers = this.timers.filter(t => t.id !== id);
    if (this.alertId === activityId) {
      this.alertId = this.timers.find(t => t.status === "finished")?.id ?? null;
      if (this.alertId) this.alertId = `timer:${this.alertId}`;
      else { this.selectedId = this.beforeAlert; this.beforeAlert = null; }
    }
    if (this.selectedId === activityId) this.selectedId = null;
    if (this.pinnedId === activityId) this.pinnedId = null;
    this.save(); this.notify();
  }
  /** Deadline arithmetic catches up after sleep; a finished timer rings once. */
  tick(now = Date.now()): HubTimer[] {
    const ended = this.timers.filter(t => t.status === "running" && timerRemaining(t, now) === 0);
    if (ended.length) {
      if (!this.alertId) this.beforeAlert = this.focusId;
      for (const t of ended) { t.status = "finished"; t.deadline = null; t.remainingMs = 0; }
      if (!this.alertId) this.alertId = `timer:${ended[0].id}`;
      this.save();
    }
    if (this.timers.some(t => t.status === "running") || ended.length) this.notify();
    return ended;
  }
  addShortcut(label: string, target: string): boolean {
    if (!label.trim() || !validShortcutTarget(target.trim()) || this.shortcuts.length >= 8) return false;
    this.error = "";
    this.shortcuts.push({ id: crypto.randomUUID(), label: label.trim().slice(0, 32), target: target.trim() });
    this.save(); this.notify(); return true;
  }
  removeShortcut(id: string) { this.shortcuts = this.shortcuts.filter(s => s.id !== id); this.save(); this.notify(); }
}
export const Hub = new ActivityHub();
