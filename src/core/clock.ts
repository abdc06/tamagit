/**
 * 하루 경계와 시간대를 한 곳에서 다룬다.
 * dayStartHour=4 이면 03:59 의 활동은 "전날"로 귀속된다.
 */
export interface Clock {
  timeZone: string;
  dayStartHour: number;
  /** 게임상 하루 키 (YYYY-MM-DD). 경계 시각이 반영된 값 */
  dayKey(ts: number): string;
  /** 실제 달력 날짜 (YYYY-MM-DD) */
  calendarDay(ts: number): string;
  /** 로컬 시(0-23) */
  hour(ts: number): number;
}

export function makeClock(timeZone: string, dayStartHour: number): Clock {
  // en-CA 로케일은 YYYY-MM-DD 를 낸다
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const hourFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const shift = dayStartHour * 3_600_000;

  return {
    timeZone,
    dayStartHour,
    dayKey: (ts) => dateFmt.format(new Date(ts - shift)),
    calendarDay: (ts) => dateFmt.format(new Date(ts)),
    hour: (ts) => Number(hourFmt.format(new Date(ts))),
  };
}

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" → epoch ms (UTC 자정 기준. 날짜 간 차이 계산 전용) */
export function dayToOrdinal(day: string): number {
  return Date.parse(day + 'T00:00:00Z') / DAY_MS;
}

export function ordinalToDay(ord: number): string {
  return new Date(ord * DAY_MS).toISOString().slice(0, 10);
}

/** from~to 사이의 모든 날짜(경계 포함) */
export function dayRange(from: string, to: string): string[] {
  const a = dayToOrdinal(from);
  const b = dayToOrdinal(to);
  const out: string[] = [];
  for (let d = a; d <= b; d++) out.push(ordinalToDay(d));
  return out;
}

export function addDays(day: string, n: number): string {
  return ordinalToDay(dayToOrdinal(day) + n);
}
