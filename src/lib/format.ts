/** Display formatting helpers. All output is English, per the site language policy. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const PLAIN = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value >= 1000 ? COMPACT.format(value) : PLAIN.format(value);
}

export function formatExactCount(value: number): string {
  return PLAIN.format(Number.isFinite(value) ? value : 0);
}

const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

function parseDate(iso: string): Date | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time);
}

export function formatDate(iso: string): string {
  const date = parseDate(iso);
  return date ? DATE.format(date) : '—';
}

/** Absolute timestamp in UTC, suitable for a title attribute. */
export function formatDateTime(iso: string): string {
  const date = parseDate(iso);
  return date ? DATE_TIME.format(date) : '—';
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** Relative time such as "3 hours ago". `now` is injectable for tests. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const date = parseDate(iso);
  if (!date) return '—';
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return RELATIVE.format(Math.round(seconds / 60), 'minute');
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Number of lines in a text file (a trailing newline does not add an empty line). */
export function countLines(text: string): number {
  if (text === '') return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}
