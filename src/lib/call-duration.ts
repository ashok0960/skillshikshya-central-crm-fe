const MAX_DURATION_SECONDS = 2_147_483_647;

export function parseCallDuration(value: string): number | null {
  const input = value.trim().toLowerCase();
  if (!input || input.length > 64 || input.startsWith("-")) return null;

  let seconds: number | null = null;
  if (input.includes(":")) {
    const parts = input.split(":");
    if ((parts.length === 2 || parts.length === 3) && parts.every((part) => /^\d+$/.test(part))) {
      const values = parts.map(Number);
      seconds =
        values.length === 2
          ? values[0] * 60 + values[1]
          : values[0] * 3600 + values[1] * 60 + values[2];
    }
  } else if (input.includes(".")) {
    const parts = input.split(".");
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      if (parts[1].length === 1) {
        seconds = Number(parts[0]) * 60 + Number(parts[1]) * 6;
      } else if (parts[1].length === 2) {
        seconds = Number(parts[0]) * 60 + Number(parts[1]);
      }
    }
  } else if (/^\d+m\d+s$/.test(input)) {
    const match = /^(\d+)m(\d+)s$/.exec(input);
    if (match) seconds = Number(match[1] || 0) * 60 + Number(match[2] || 0);
  } else if (/^\d+$/.test(input)) {
    seconds = Number(input);
  }

  return seconds !== null && Number.isSafeInteger(seconds) && seconds <= MAX_DURATION_SECONDS
    ? seconds
    : null;
}

export function formatCallDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function describeCallDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `= ${minutes} min ${remainder} sec`;
}
