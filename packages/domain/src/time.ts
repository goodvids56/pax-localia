import type { InWorldDate, JumpSize } from './schemas';
import { InWorldDateSchema } from './schemas';

function parseParts(date: InWorldDate): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Invalid in-world date: ${date}`);
  }
  return [year, month, day];
}

function formatDate(value: Date): InWorldDate {
  return InWorldDateSchema.parse(value.toISOString().slice(0, 10));
}

function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addJump(date: InWorldDate, jump: JumpSize): InWorldDate {
  const [year, month, day] = parseParts(date);
  const value = new Date(Date.UTC(year, month - 1, day));

  switch (jump.unit) {
    case 'day':
      value.setUTCDate(value.getUTCDate() + jump.value);
      return formatDate(value);
    case 'week':
      value.setUTCDate(value.getUTCDate() + jump.value * 7);
      return formatDate(value);
    case 'month': {
      const totalMonths = year * 12 + (month - 1) + jump.value;
      const nextYear = Math.floor(totalMonths / 12);
      const nextMonth = totalMonths % 12;
      return formatDate(
        new Date(Date.UTC(nextYear, nextMonth, Math.min(day, daysInUtcMonth(nextYear, nextMonth)))),
      );
    }
    case 'year': {
      const nextYear = year + jump.value;
      const monthIndex = month - 1;
      return formatDate(
        new Date(
          Date.UTC(nextYear, monthIndex, Math.min(day, daysInUtcMonth(nextYear, monthIndex))),
        ),
      );
    }
  }
}

export function compareDates(left: InWorldDate, right: InWorldDate): number {
  return left.localeCompare(right);
}

export function isDateWithin(value: InWorldDate, start: InWorldDate, end: InWorldDate): boolean {
  return compareDates(value, start) >= 0 && compareDates(value, end) <= 0;
}

export function formatInWorldDate(date: InWorldDate): string {
  const [year, month, day] = parseParts(date);
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
