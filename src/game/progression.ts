import { config } from '../config';
import type { GameContext } from '../core/context';
import type { MedalId, SaveData } from '../core/save';
import { customizedLook, factoryAccessories, type AccessoryId } from '../data/accessories';
import type { AchievementDef, CarDef } from '../data/types';
import { todayKey } from '../data/mountains';
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

/** Applies the result of a descent to the save file (score based, no times). */
export function finalizeRun(ctx: GameContext, session: RunSession): RunSummary {
  const save = ctx.save.data;
  const { cfg } = session;
  const finished = session.phase === 'finished';
  const record = ctx.save.record(cfg.mountain.id, cfg.mode.id);
  const previousBest = record.runs > 0 ? record.bestScore : null;
  record.runs++;
  let newRecord = false;
  if (finished && cfg.mode.recordsEnabled) {
    if (session.score > record.bestScore) {
      record.bestScore = session.score;
      newRecord = previousBest !== null;
    }
    if (MEDAL_RANK[session.medal] > MEDAL_RANK[record.medal]) {
      if (session.medal === 'gold') save.stats.goldMedals++;
      record.medal = session.medal;
    }
    if (cfg.mode.id === 'daily') {
      const key = todayKey();
      if (save.daily.date !== key) save.daily = { date: key, bestScore: 0, medal: 'none' };
      save.daily.bestScore = Math.max(save.daily.bestScore, session.score);
      if (MEDAL_RANK[session.medal] > MEDAL_RANK[save.daily.medal])
        save.daily.medal = session.medal;
    }
  }
  // Coins: collected coins + style score bonus + medal bonus.
  const medalBonus = { none: 0, bronze: 100, silver: 200, gold: 350 }[session.medal];
  const coins =
    session.coins +
    Math.floor((session.score / 1000) * config.gameplay.coinsPerThousandScore) +
    medalBonus;
  save.coins += coins;
  save.stats.totalCoins += coins;
  if (finished) save.stats.runsFinished++;
  save.stats.totalDistance += session.vehicle.physics.odometer;
  checkAchievements(ctx);
  ctx.save.save();
  const extra = session.systems.flatMap((s) => s.summary?.() ?? []);
  return {
    finished,
    score: session.score,
    medal: session.medal,
    coinsEarned: coins,
    crystals: session.crystals,
    newRecord: finished && cfg.mode.recordsEnabled && newRecord,
    previousBest,
    topSpeed: session.vehicle.telemetry.topSpeed,
    bestAir: session.vehicle.telemetry.bestAir,
    stats: { ...session.stats, distance: session.vehicle.physics.odometer },
    extra,
  };
}

/** Whether a track is unlocked for the current save. */
export function isMountainUnlocked(ctx: GameContext, mountainId: string): boolean {
  const mountain = ctx.registries.mountains.get(mountainId);
  if (!mountain.unlockAfter) return true;
  const rec = ctx.save.data.records[`${mountain.unlockAfter}:freeDescent`];
  return !!rec && rec.runs > 0 && rec.bestScore > 0;
}

/**
 * A jeep as the player configured it: accessories switched on in the garage (factory
 * accessories until the player changes them). Paint is chosen separately (carColors).
 */
export function configuredJeep(save: SaveData, def: CarDef): CarDef {
  const on = save.accessoriesOn[def.id];
  return on ? { ...def, look: customizedLook(def.look, on) } : def;
}

/** Accessories a jeep owns: factory ones plus those bought. */
export function ownedAccessories(save: SaveData, def: CarDef): AccessoryId[] {
  return Array.from(
    new Set([...factoryAccessories(def.look), ...(save.accessories[def.id] ?? [])]),
  );
}

/** Accessories currently shown on a jeep. */
export function accessoriesOn(save: SaveData, def: CarDef): AccessoryId[] {
  return save.accessoriesOn[def.id] ?? factoryAccessories(def.look);
}
