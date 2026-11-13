import type { TrackDef } from '../types';
import { pineRidge } from './pineRidge';
import { granitePass } from './granitePass';
import { frostbitePeak } from './frostbitePeak';

/** Campaign tracks in menu order. To add a track: create a file next to these and list it here. */
export const tracks: TrackDef[] = [pineRidge, granitePass, frostbitePeak];

export { createDailyTrack, todayKey } from './daily';
