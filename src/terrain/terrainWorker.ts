/// <reference lib="webworker" />
/**
 * Terrain worker: generates course data (landforms, erosion, streams, trail routing) off the
 * main thread, then keeps the course to build terrain patches on request (see
 * terrainService.ts for the protocol).
 */
import { buildCourseData, Course, type CourseData } from './course';
import { ArrayPool, buildPatch, type PatchArrays, type PatchRequest } from './patchBuilder';
import type { MountainDef } from '../data/types';
import type { PatchPalette } from './splat';

export type WorkerRequest =
  | { type: 'generate'; id: number; def: MountainDef }
  | { type: 'activate'; def: MountainDef; data: CourseData; palette: PatchPalette }
  | { type: 'patch'; req: PatchRequest }
  | { type: 'recycle'; buffers: ArrayBuffer[] };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: number }
  | { type: 'generated'; id: number; data: CourseData }
  | { type: 'error'; id: number; message: string }
  | { type: 'patchError'; key: number; gen: number; message: string }
  | { type: 'patch'; key: number; gen: number; result: PatchArrays };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let active: { course: Course; palette: PatchPalette; gen: number } | null = null;
let generation = 0;
const pool = new ArrayPool();

scope.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const msg = e.data;
  try {
    if (msg.type === 'generate') {
      const data = buildCourseData(msg.def, (p) =>
        scope.postMessage({ type: 'progress', id: msg.id, progress: p } as WorkerResponse),
      );
      scope.postMessage({ type: 'generated', id: msg.id, data } as WorkerResponse);
    } else if (msg.type === 'activate') {
      active = { course: new Course(msg.def, msg.data), palette: msg.palette, gen: ++generation };
    } else if (msg.type === 'patch') {
      if (!active || msg.req.gen !== active.gen) return;
      const result = buildPatch(active.course.terrain, active.palette, msg.req, pool);
      scope.postMessage(
        { type: 'patch', key: msg.req.key, gen: msg.req.gen, result } as WorkerResponse,
        [result.position.buffer, result.color.buffer, result.normal.buffer],
      );
    } else if (msg.type === 'recycle') {
      const [p, c, n] = msg.buffers;
      pool.give({
        position: new Int16Array(p),
        color: new Uint8Array(c),
        normal: new Int8Array(n),
      });
    }
  } catch (err) {
    if (msg.type === 'patch')
      scope.postMessage({
        type: 'patchError',
        key: msg.req.key,
        gen: msg.req.gen,
        message: String(err),
      } as WorkerResponse);
    else if (msg.type === 'generate')
      scope.postMessage({ type: 'error', id: msg.id, message: String(err) } as WorkerResponse);
  }
};
