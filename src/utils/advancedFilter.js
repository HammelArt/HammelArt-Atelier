export const ASPECT_RATIO_PRESETS = [
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "2:3", label: "2:3", ratio: 2 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "21:9", label: "21:9", ratio: 21 / 9 },
];

export const FORMAT_OPTIONS = [
  { id: "png", label: "PNG" },
  { id: "jpg", label: "JPG" },
  { id: "webp", label: "WEBP" },
  { id: "avif", label: "AVIF" },
  { id: "gif", label: "GIF" },
  { id: "mp4", label: "MP4" },
  { id: "webm", label: "WEBM" },
  { id: "mov", label: "MOV" },
];

export const SIZE_PRESETS = [
  { id: "any", label: "Any", min: "", max: "" },
  { id: "lt1", label: "< 1", min: "", max: "1" },
  { id: "1-5", label: "1–5", min: "1", max: "5" },
  { id: "5-10", label: "5–10", min: "5", max: "10" },
  { id: "10-25", label: "10–25", min: "10", max: "25" },
  { id: "25+", label: "25+", min: "25", max: "" },
];

export const MP_PRESETS = [
  { id: "any", label: "Any", min: "", max: "" },
  { id: "lt1", label: "< 1 MP", min: "", max: "1" },
  { id: "1-2", label: "1–2 MP", min: "1", max: "2" },
  { id: "2-6", label: "2–6 MP", min: "2", max: "6" },
  { id: "6+", label: "6+ MP", min: "6", max: "" },
];

export const DATE_PRESETS = [
  { id: "all", label: "Any Time" },
  { id: "today", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
  { id: "older30", label: "30d+" },
  { id: "older90", label: "90d+" },
  { id: "custom", label: "Custom" },
];

export const DEFAULT_ADVANCED_FILTER = {
  mediaType: "all", // "all" | "image" | "video"
  formats: [],
  workflow: "all", // "all" | "with" | "without"
  minSizeMb: "",
  maxSizeMb: "",
  minMp: "",
  maxMp: "",
  minWidth: "",
  minHeight: "",
  orientation: "all", // "all" | "portrait" | "square" | "landscape"
  aspectPresets: [],
  datePreset: "all", // "all" | "today" | "7d" | "30d" | "older30" | "older90" | "custom"
  dateFrom: "",
  dateTo: "",
  model: "all",
  minDurationSec: "",
  maxDurationSec: "",
  hasAudio: "all", // "all" | "yes" | "no"
  pinnedOnly: false,
  hasNoteOnly: false,
};

export function cloneAdvancedFilter(src = DEFAULT_ADVANCED_FILTER) {
  const f = src || DEFAULT_ADVANCED_FILTER;
  return {
    ...DEFAULT_ADVANCED_FILTER,
    ...f,
    formats: Array.isArray(f.formats) ? [...f.formats] : [],
    aspectPresets: Array.isArray(f.aspectPresets) ? [...f.aspectPresets] : [],
  };
}

export function countActiveAdvancedFilters(f) {
  if (!f) return 0;
  let count = 0;
  if (f.mediaType && f.mediaType !== "all") count += 1;
  if (Array.isArray(f.formats) && f.formats.length > 0) count += 1;
  if (f.workflow && f.workflow !== "all") count += 1;
  if (f.minSizeMb !== "" || f.maxSizeMb !== "") count += 1;
  if (f.minMp !== "" || f.maxMp !== "") count += 1;
  if (f.minWidth !== "" || f.minHeight !== "") count += 1;
  if (f.orientation && f.orientation !== "all") count += 1;
  if (Array.isArray(f.aspectPresets) && f.aspectPresets.length > 0) count += 1;
  if (
    (f.datePreset && f.datePreset !== "all" && f.datePreset !== "custom") ||
    f.dateFrom !== "" ||
    f.dateTo !== ""
  ) {
    count += 1;
  }
  if (f.model && f.model !== "all") count += 1;
  if (f.minDurationSec !== "" || f.maxDurationSec !== "") count += 1;
  if (f.hasAudio && f.hasAudio !== "all") count += 1;
  if (f.pinnedOnly) count += 1;
  if (f.hasNoteOnly) count += 1;
  return count;
}

export function extractItemExtension(filename = "") {
  const idx = String(filename).lastIndexOf(".");
  if (idx < 0) return "";
  const raw = filename.slice(idx + 1).toLowerCase();
  return raw === "jpeg" ? "jpg" : raw;
}

function parseOptionalNum(val) {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

const PRESET_RATIO_MAP = new Map(ASPECT_RATIO_PRESETS.map((p) => [p.id, p.ratio]));

export function matchesAdvancedFilter(item, f, opts = {}, nowSec = Date.now() / 1000) {
  if (!f || !item) return true;
  const { key = "", pinSet = null, notesMap = null } = opts;

  if (f.mediaType === "image" && item.media_type === "video") return false;
  if (f.mediaType === "video" && item.media_type !== "video") return false;

  if (Array.isArray(f.formats) && f.formats.length > 0) {
    const ext = extractItemExtension(item.filename);
    if (!f.formats.includes(ext)) return false;
  }

  if (f.workflow === "with" && !item.has_workflow) return false;
  if (f.workflow === "without" && item.has_workflow) return false;

  const minMb = parseOptionalNum(f.minSizeMb);
  const maxMb = parseOptionalNum(f.maxSizeMb);
  if (minMb !== null || maxMb !== null) {
    const mb = Number(item.file_size_mb) || (Number(item.file_size_bytes) || 0) / (1024 * 1024);
    if (minMb !== null && mb < minMb) return false;
    if (maxMb !== null && mb > maxMb) return false;
  }

  const w = Number(item.width) || 0;
  const h = Number(item.height) || 0;

  const minMp = parseOptionalNum(f.minMp);
  const maxMp = parseOptionalNum(f.maxMp);
  if (minMp !== null || maxMp !== null) {
    const mp = w > 0 && h > 0 ? (w * h) / 1_000_000 : 0;
    if (minMp !== null && mp < minMp) return false;
    if (maxMp !== null && mp > maxMp) return false;
  }

  const minW = parseOptionalNum(f.minWidth);
  const minH = parseOptionalNum(f.minHeight);
  if (minW !== null && w < minW) return false;
  if (minH !== null && h < minH) return false;

  if (f.orientation && f.orientation !== "all") {
    const bucket =
      item.aspect_bucket ||
      (w > 0 && h > 0 ? (w / h > 1.12 ? "landscape" : w / h < 0.88 ? "portrait" : "square") : "");
    if (bucket !== f.orientation) return false;
  }

  if (Array.isArray(f.aspectPresets) && f.aspectPresets.length > 0) {
    const ar = Number(item.aspect_ratio) || (w > 0 && h > 0 ? w / h : 0);
    if (ar <= 0) return false;
    const hit = f.aspectPresets.some((id) => {
      const target = PRESET_RATIO_MAP.get(id);
      return target ? Math.abs(ar - target) / target <= 0.085 : false;
    });
    if (!hit) return false;
  }

  const mtime = Number(item.mtime) || 0;
  if (f.datePreset && f.datePreset !== "all" && f.datePreset !== "custom") {
    const DAY = 86400;
    if (f.datePreset === "today" && nowSec - mtime > DAY) return false;
    if (f.datePreset === "7d" && nowSec - mtime > 7 * DAY) return false;
    if (f.datePreset === "30d" && nowSec - mtime > 30 * DAY) return false;
    if (f.datePreset === "older30" && nowSec - mtime < 30 * DAY) return false;
    if (f.datePreset === "older90" && nowSec - mtime < 90 * DAY) return false;
  } else if (f.dateFrom || f.dateTo) {
    if (f.dateFrom) {
      const fromTs = Date.parse(`${f.dateFrom}T00:00:00`) / 1000;
      if (Number.isFinite(fromTs) && mtime < fromTs) return false;
    }
    if (f.dateTo) {
      const toTs = Date.parse(`${f.dateTo}T23:59:59.999`) / 1000;
      if (Number.isFinite(toTs) && mtime > toTs) return false;
    }
  }

  if (f.model && f.model !== "all") {
    if ((item.model_short || "") !== f.model) return false;
  }

  const minDur = parseOptionalNum(f.minDurationSec);
  const maxDur = parseOptionalNum(f.maxDurationSec);
  if (minDur !== null || maxDur !== null) {
    if (item.media_type !== "video") return false;
    const dur = Number(item.duration_sec) || 0;
    if (minDur !== null && dur < minDur) return false;
    if (maxDur !== null && dur > maxDur) return false;
  }

  if (f.hasAudio && f.hasAudio !== "all") {
    if (item.media_type !== "video") return false;
    if (f.hasAudio === "yes" && !item.has_audio) return false;
    if (f.hasAudio === "no" && item.has_audio) return false;
  }

  if (f.pinnedOnly && (!pinSet || !pinSet.has(key))) return false;
  if (f.hasNoteOnly && (!notesMap || !String(notesMap[key] || "").trim())) return false;

  return true;
}
