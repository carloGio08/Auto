import { config } from '../config';
import type { GameContext } from '../core/context';
import type { MedalId } from '../core/save';
import type { AchievementDef } from '../data/types';
import { todayKey } from '../data/tracks';
import type { RunSession, RunSummary } from './session';

const MEDAL_RANK: Record<MedalId, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

/** Unlocks every achievement whose condition is now met; returns the new ones. */
export function checkAchievements(ctx: GameContext): AchievementDef[] {
  const save = ctx.save.data;
  const unlocked: AchievementDef[] = [];
  for (const a of ctx.registries.achievements.all()) {
    if (save.achievements.includes(a.id)) continue;
    if (a.check(save.stats)) {
      save.achievements.push(a.id);
      save.coins += a.reward;
      unlocked.push(a);
    }
  }
  if (unlocked.length) ctx.save.save();
  return unlocked;
}

/** Applies the result of a finished (or timed-out) run to the save file. */
export function finalizeRun(ctx: GameContext, session: RunSession): RunSummary {
  const save = ctx.save.data;
  const { cfg } = session;
  const finished = session.phase === 'finished';
  const record = ctx.save.record(cfg.track.id, cfg.mode.id);
  const previousBest = record.bestTime;
  record.runs++;
  let newRecord = false;
  if (finished && cfg.mode.recordsEnabled) {
    if (record.bestTime === null || session.time < record.bestTime) {
      record.bestTime = session.time;
      newRecord = true;
    }
    if (session.score > record.bestScore) record.bestScore = session.score;
    if (MEDAL_RANK[session.medal] > MEDAL_RANK[record.medal]) {
      if (session.medal === 'gold') save.stats.goldMedals++;
      record.medal = session.medal;
    }
    if (cfg.mode.id === 'daily') {
      const key = todayKey();
      if (save.daily.date !== key) save.daily = { date: key, bestTime: null, medal: 'none' };
      if (save.daily.bestTime === null || session.time < save.daily.bestTime)
        save.daily.bestTime = session.time;
      if (MEDAL_RANK[session.medal] > MEDAL_RANK[save.daily.medal])
        save.daily.medal = session.medal;
    }
  }
  // Coins: collected coins + style score bonus + medal bonus (half if not finished).
  const medalBonus = { none: 0, bronze: 100, silver: 200, gold: 350 }[session.medal];
  let coins =
    session.coins +
    Math.floor((session.score / 1000) * config.gameplay.coinsPerThousandScore) +
    medalBonus;
  if (!finished) coins = Math.floor(coins * 0.5);
  save.coins += coins;
  save.stats.totalCoins += coins;
  if (finished) save.stats.runsFinished++;
  save.stats.totalDistance += session.vehicle.physics.odometer;
  checkAchievements(ctx);
  ctx.save.save();
  const extra = session.systems.flatMap((s) => s.summary?.() ?? []);
  return {
    finished,
    time: session.time,
    score: session.score,
    medal: session.medal,
    coinsEarned: coins,
    crystals: session.crystals,
    newRecord: finished && cfg.mode.recordsEnabled && newRecord,
    previousBest,
    topSpeed: session.vehicle.telemetry.topSpeed,
    bestAir: session.vehicle.telemetry.bestAir,
    extra,
  };
}

/** Whether a track is unlocked for the current save. */
export function isTrackUnlocked(ctx: GameContext, trackId: string): boolean {
  const track = ctx.registries.tracks.get(trackId);
  if (!track.unlockAfter) return true;
  const rec = ctx.save.data.records[`${track.unlockAfter}:timeAttack`];
  return !!rec && MEDAL_RANK[rec.medal] >= 1;
}
