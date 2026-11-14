import type { MountainDef } from '../data/types';
import { buildCourseData, type Course, type CourseData } from './course';
import { ArrayPool, PatchBuild, type PatchArrays, type PatchRequest } from './patchBuilder';
import type { PatchPalette } from './splat';
import type { WorkerRequest, WorkerResponse } from './terrainWorker';

/** A course generation in progress (or done). Poll it from a state's update. */
export interface TerrainJob {
  readonly key: string;
  progress: number;
  done: boolean;
  data: CourseData | null;
  error: string | null;
}

/** Where terrain patches get built: the worker, or the main thread in time slices. */
export interface PatchBackend {
  /** Queues a patch; `done` is called once with the geometry arrays. */
  request(req: Omit<PatchRequest, 'gen'>, done: (r: PatchArrays) => void): void;
  /** Gives back the arrays of a freed patch for reuse. */
  recycle(r: PatchArrays): void;
  /** Main-thread work for this frame (no-op for the worker). */
  pump(budgetMs: number): void;
  /** Requests not answered yet. */
  readonly pending: number;
  /** Drops queued requests (positions changed a lot, e.g. a teleport). */
  cancelAll(): void;
}

const keyOf = (def: MountainDef): string => `${def.id}:${def.seed}`;

/** Builds patches on the main thread within a per-frame budget (fallback, tests). */
class LocalBackend implements PatchBackend {
  private readonly queue: { req: PatchRequest; done: (r: PatchArrays) => void }[] = [];
  private current: { b: PatchBuild; done: (r: PatchArrays) => void } | null = null;
  private readonly pool = new ArrayPool();

  constructor(
    private readonly course: Course,
    private readonly palette: PatchPalette,
  ) {}

  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  request(req: Omit<PatchRequest, 'gen'>, done: (r: PatchArrays) => void): void {
    this.queue.push({ req: { ...req, gen: 0 }, done });
  }

  recycle(r: PatchArrays): void {
    this.pool.give(r);
  }

  cancelAll(): void {
    this.queue.length = 0;
    this.current = null;
  }

  pump(budgetMs: number): void {
    const end = performance.now() + budgetMs;
    while (performance.now() < end) {
      if (!this.current) {
        const next = this.queue.shift();
        if (!next) return;
        this.current = {
          b: new PatchBuild(this.course.terrain, this.palette, next.req, this.pool),
          done: next.done,
        };
      }
      if (this.current.b.step(end)) {
        const c = this.current;
        this.current = null;
        c.done(c.b.result!);
      }
    }
  }
}

/** Builds patches in the terrain worker. */
class WorkerBackend implements PatchBackend {
  private readonly waiting = new Map<number, (r: PatchArrays) => void>();

  constructor(
    private readonly service: TerrainService,
    readonly gen: number,
  ) {}

  get pending(): number {
    return this.waiting.size;
  }

  request(req: Omit<PatchRequest, 'gen'>, done: (r: PatchArrays) => void): void {
    this.waiting.set(req.key, done);
    this.service.post({ type: 'patch', req: { ...req, gen: this.gen } });
  }

  recycle(r: PatchArrays): void {
    const buffers = [r.position.buffer, r.color.buffer, r.normal.buffer] as ArrayBuffer[];
    this.service.post({ type: 'recycle', buffers }, buffers);
  }

  receive(key: number, r: PatchArrays): void {
    const cb = this.waiting.get(key);
    if (!cb) return;
    this.waiting.delete(key);
    cb(r);
  }

  cancelAll(): void {
    this.waiting.clear();
  }

  pump(): void {}
}

/**
 * App-lifetime terrain service: generates course data in a Web Worker (with progress),
 * caches the last few results, and builds terrain patches in the same worker for the active
 * world. Falls back to synchronous generation on the main thread where workers are missing.
 */
export class TerrainService {
  private worker: Worker | null = null;
  private readonly jobs = new Map<string, TerrainJob>();
  private readonly byId = new Map<number, TerrainJob>();
  private nextId = 1;
  private gen = 0;
  private active: WorkerBackend | null = null;

  constructor(
    private readonly maxCache = 3,
    useWorker = typeof Worker !== 'undefined',
  ) {
    if (!useWorker) return;
    try {
      this.worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      this.worker.onerror = () => this.failWorker();
    } catch {
      this.worker = null;
    }
  }

  post(msg: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === 'patch') {
      if (this.active && msg.gen === this.active.gen) this.active.receive(msg.key, msg.result);
      return;
    }
    const job = this.byId.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') job.progress = msg.progress;
    else if (msg.type === 'generated') {
      job.data = msg.data;
      job.progress = 1;
      job.done = true;
      this.byId.delete(msg.id);
    } else if (msg.type === 'error') {
      job.error = msg.message;
      job.done = true;
      this.byId.delete(msg.id);
      this.jobs.delete(job.key);
    }
  }

  /** The worker died (e.g. blocked by the browser): finish pending jobs synchronously. */
  private failWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
    this.byId.clear();
  }

  /** Starts (or returns the cached / running) generation of a mountain. */
  prepare(def: MountainDef): TerrainJob {
    const key = keyOf(def);
    const existing = this.jobs.get(key);
    if (existing && !existing.error && (existing.done || this.worker))
      return this.touch(key, existing);
    const job: TerrainJob = { key, progress: 0, done: false, data: null, error: null };
    this.jobs.set(key, job);
    if (this.worker) {
      const id = this.nextId++;
      this.byId.set(id, job);
      this.post({ type: 'generate', id, def });
    } else {
      job.data = buildCourseData(def);
      job.progress = 1;
      job.done = true;
    }
    this.trim();
    return job;
  }

  /** Course data now: cached, or generated synchronously on the main thread. */
  getSync(def: MountainDef): CourseData {
    const job = this.jobs.get(keyOf(def));
    if (job?.data) return this.touch(job.key, job).data!;
    const data = buildCourseData(def);
    const j: TerrainJob = { key: keyOf(def), progress: 1, done: true, data, error: null };
    this.jobs.set(j.key, j);
    this.trim();
    return data;
  }

  private touch(key: string, job: TerrainJob): TerrainJob {
    // Most recently used last.
    this.jobs.delete(key);
    this.jobs.set(key, job);
    return job;
  }

  private trim(): void {
    while (this.jobs.size > this.maxCache) {
      const oldest = this.jobs.keys().next().value as string;
      this.jobs.delete(oldest);
    }
  }

  /**
   * Patch builder for a world: the worker (which receives the course data and palette) or
   * the main thread.
   */
  backend(course: Course, palette: PatchPalette): PatchBackend {
    const data = this.jobs.get(keyOf(course.def))?.data;
    if (!this.worker || !data) return new LocalBackend(course, palette);
    this.gen++;
    this.post({ type: 'activate', def: course.def, data, palette });
    this.active = new WorkerBackend(this, this.gen);
    return this.active;
  }

  /** A main-thread backend (tests, tools). */
  static local(course: Course, palette: PatchPalette): PatchBackend {
    return new LocalBackend(course, palette);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.jobs.clear();
  }
}
