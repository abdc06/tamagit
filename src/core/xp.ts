import type { XpConfig } from './config.ts';
import type { ParsedPrompt } from './history.ts';

/**
 * 프롬프트 1건의 XP.
 *
 * 설계 근거(스파이크 §2): 최다 입력이 "진행시켜"(4자·33회), 최장이 1,184자다.
 * 선형 길이 보상은 장문 하나가 하루를 끝내버리므로 로그 스케일을 쓴다.
 *   4자   → 12 XP
 *   36자  → 18 XP  (p50)
 *   133자 → 26 XP  (p90)
 *   1184자→ 43 XP  (max)
 * 멀티라인(전체의 21.8%)은 "제대로 쓴 프롬프트"의 프록시라 별도 가산한다.
 */
export function promptXp(p: ParsedPrompt, cfg: XpConfig): number {
  let xp = cfg.base + Math.round(cfg.lengthWeight * Math.log1p(p.charLen / cfg.lengthScale));
  if (p.isMultiline) xp += cfg.multilineBonus;
  if (p.pastedCount > 0) xp += cfg.pasteBonus;
  if (p.isSlash || p.isBang) xp = Math.round(xp * cfg.commandFactor);
  return Math.max(1, xp);
}

/** 레벨 n → n+1 에 필요한 XP */
export function xpToNext(level: number): number {
  return Math.round(500 * Math.pow(level, 1.4));
}

export interface LevelInfo {
  level: number;
  /** 현재 레벨 안에서 쌓인 XP */
  intoLevel: number;
  /** 다음 레벨까지 필요한 XP */
  needed: number;
  /** 0~1 진행도 */
  progress: number;
  totalXp: number;
}

const MAX_LEVEL = 999;

export function levelFromXp(totalXp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  let needed = xpToNext(level);
  while (remaining >= needed && level < MAX_LEVEL) {
    remaining -= needed;
    level++;
    needed = xpToNext(level);
  }
  return {
    level,
    intoLevel: remaining,
    needed,
    progress: needed > 0 ? remaining / needed : 1,
    totalXp: Math.max(0, Math.floor(totalXp)),
  };
}

/** 스트릭 보너스: 연속 N일차면 그날 소계에 (N-1)%를 가산 (최대 +30%) */
export function streakBonus(subtotal: number, streakLen: number, cfg: XpConfig): number {
  const days = Math.min(Math.max(streakLen - 1, 0), cfg.maxStreakBonusDays);
  return Math.round(subtotal * days * cfg.streakBonusPerDay);
}
