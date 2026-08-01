export function shortId(value: string) { return value.slice(0, 8); }
export function humanize(value: string) { return value.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').toLowerCase(); }
export function relativeTime(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000)); if (seconds < 60) return 'now'; if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`; return `${Math.floor(seconds / 86_400)}d`; }
