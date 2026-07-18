export function formatRelativeTime(seconds: number, language: string): string {
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff <= 0) {
    try {
      return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second');
    } catch {
      return 'just now';
    }
  }

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'week', seconds: 604800 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
  ];

  for (const { unit, seconds: unitSeconds } of units) {
    const value = Math.floor(diff / unitSeconds);
    if (value >= 1) {
      try {
        return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(-value, unit);
      } catch {
        return `${value} ${unit}s ago`;
      }
    }
  }

  try {
    return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'second');
  } catch {
    return 'just now';
  }
}
