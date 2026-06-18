const BEIJING_TIME_ZONE = "Asia/Shanghai";
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const minuteFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const secondFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function parseTime(value?: string | number | Date | null) {
  if (!value) return null;
  if (typeof value === "string" && DATE_ONLY_RE.test(value)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDate(value: string) {
  return value.replace(/\//g, "-");
}

function normalizeDateTime(value: string) {
  return normalizeDate(value).replace(/\s+/g, " ");
}

export function formatBeijingDate(value?: string | number | Date | null) {
  if (!value) return "-";
  if (typeof value === "string" && DATE_ONLY_RE.test(value)) return value;
  const date = parseTime(value);
  return date ? normalizeDate(dateFormatter.format(date)) : String(value).slice(0, 10);
}

export function formatBeijingDateTime(value?: string | number | Date | null, precision: "minute" | "second" = "minute") {
  if (!value) return "-";
  if (typeof value === "string" && DATE_ONLY_RE.test(value)) return value;
  const date = parseTime(value);
  if (!date) return String(value);
  return normalizeDateTime((precision === "second" ? secondFormatter : minuteFormatter).format(date));
}
