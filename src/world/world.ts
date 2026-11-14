import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Fog,
  Mesh,
  MeshLambertMaterial,
  Scene,
  Vector3,
} from 'three';
import { atmosphereUniforms, installAtmosphere, setAtmosphere } from './atmosphere';
import { config, type QualityPreset } from '../config';
import {
  defaultPalette,
  resolvePalette,
  timeThemes,
  weatherThemes,
  type ResolvedPalette,
} from '../data/palette';
import type { TimeOfDayDef, WeatherDef } from '../data/types';
import type { I18nKey } from '../i18n/en';
import type { Course } from '../terrain/course';
import { TerrainMesh } from '../terrain/terrainMesh';
import { toPatchPalette } from '../terrain/splat';
import { TerrainService, type PatchBackend } from '../terrain/terrainService';
import { CollisionWorld } from './colliders';
import { Lighting } from './lighting';
import { Props } from './props';
import { Sky } from './sky';
import { Structures } from './structures';
import { Water } from './water';
import { Snowfall } from './weather';

export interface WorldOptions {
  course: Course;
  time: TimeOfDayDef;
  weather: WeatherDef;
  preset: QualityPreset;
  /** Builds terrain patches in the worker when given (else on the main thread). */
  terrain?: TerrainService;
}

export interface BuildStep {
  stage: I18nKey;
  progress: number;
  /** Waiting for a worker: nothing more to do this frame. */
  wait?: boolean;
}

/**
 * Everything static in a level: quadtree terrain, streamed props, trail furniture, sky, water,
 * weather and lights, all coloured from the palette recoloured by the time/weather theme.
 * Built incrementally (generator) so the loading screen can show progress.
 */
export class World {
  readonly scene = new Scene();
  readonly colliders = new CollisionWorld();
  readonly course: Course;
  readonly time: TimeOfDayDef;
  readonly weather: WeatherDef;
  readonly palette: ResolvedPalette;
  preset: QualityPreset;
  terrainMesh!: TerrainMesh;
  props!: Props;
  structures!: Structures;
  sky!: Sky;
  lighting!: Lighting;
  water!: Water;
  snow: Snowfall | null = null;
  readonly fogColor: Color;
  private elapsed = 0;
  private readonly terrainService: TerrainService | undefined;

  constructor(opts: WorldOptions) {
    this.course = opts.course;
    this.terrainService = opts.terrain;
    this.time = opts.time;
    this.weather = opts.weather;
    this.preset = opts.preset;
    this.palette = resolvePalette(
      defaultPalette,
      timeThemes[this.time.id],
      weatherThemes[this.weather.id],
    );
    this.fogColor = new Color(this.time.fogColor).lerp(
      new Color('#a7b0ba'),
      this.weather.overcast * 0.6,
    );
    // Atmosphere: haze towards the sky's horizon colour, height fog in the fog colour.
    installAtmosphere();
    const grey = new Color('#9aa3ad');
    this.hazeColor = new Color(this.time.skyHorizon).lerp(grey, this.weather.overcast);
    this.scene.background = this.hazeColor.clone();
    this.applyFog();
  }

  readonly hazeColor: Color;
  /** Far-field ring (distant terrain), once built. */
  farField: Mesh | null = null;

  /** Pushes this world's atmosphere into the shared shader uniforms. */
  private applyAtmosphereUniforms(): void {
    const w = this.weather;
    const visibility = (config.world.fogVisibility * this.fogScale) / Math.sqrt(w.fogDensity);
    setAtmosphere({
      haze: this.hazeColor,
      low: this.fogColor,
      hazeDistance: (9000 * this.fogScale) / w.fogDensity,
      visibility,
      base: this.course.def.lake.level,
      density: 0.00022 * w.fogDensity * w.fogDensity,
      falloff: 170,
    });
    this.sky?.setFogBand(Math.min(0.5, (0.3 * config.world.fogVisibility) / visibility));
  }

  /** Fog distance multiplier (the opening fly-over looks further). */
  private fogScale = 1;

  setFogScale(k: number): void {
    if (Math.abs(k - this.fogScale) < 0.01) return;
    this.fogScale = k;
    this.applyFog();
  }

  private applyFog(): void {
    // The Fog only switches the fog code on; the atmosphere uniforms drive it.
    if (!this.scene.fog) this.scene.fog = new Fog(this.fogColor, 1, 30000);
    this.applyAtmosphereUniforms();
  }

  /** Builds the far-field ring in the worker (or on the main thread) and adds it. */
  private requestFarField(backend: PatchBackend): void {
    backend.requestFarField(
      {
        hole: this.terrainMesh.rootHalf,
        spacing: this.preset.farSpacing,
        extent: this.preset.farExtent,
      },
      (a) => {
        if (this.disposed) return;
        const geo = new BufferGeometry();
        geo.setAttribute('position', new BufferAttribute(a.position, 3));
        geo.setAttribute('color', new BufferAttribute(a.color, 3, true));
        geo.setIndex(new BufferAttribute(a.index, 1));
        const mesh = new Mesh(
          geo,
          new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
        );
        mesh.name = 'farField';
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        this.farField = mesh;
        this.scene.add(mesh);
      },
    );
  }

  private disposed = false;

  /** Incremental build around the start (or `focus`); iterate to completion. */
  *build(focus?: { x: number; y: number; z: number }): Generator<BuildStep> {
    const course = this.course;
    const st = focus ?? course.start;
    yield { stage: 'loading.terrain', progress: 0.3 };
    const pal = toPatchPalette(this.palette);
    const backend = this.terrainService
      ? this.terrainService.backend(course, pal)
      : TerrainService.local(course, pal);
    this.terrainMesh = new TerrainMesh(
      course.terrain,
      pal,
      {
        lod0Cell: this.preset.terrainCell,
        lod0Radius: this.preset.lod0Radius,
        triangleBudget: this.preset.triangleBudget,
        maxPatchCells: this.preset.patchCells,
      },
      backend,
    );
    this.scene.add(this.terrainMesh.group);
    this.requestFarField(backend);
    const async = !!this.terrainService && this.async;
    const gen = async
      ? this.terrainMesh.prebuildAsync(st.x, st.y + 4, st.z)
      : this.terrainMesh.prebuild(st.x, st.y + 4, st.z);
    for (const p of gen) yield { stage: 'loading.terrain', progress: 0.3 + p * 0.35, wait: async };
    yield { stage: 'loading.road', progress: 0.68 };
    this.water = new Water(course, this.palette);
    this.scene.add(this.water.group);
    this.structures = new Structures(course, this.colliders, this.palette);
    this.structures.build();
    this.scene.add(this.structures.group);
    yield { stage: 'loading.props', progress: 0.75 };
    this.props = new Props(course, this.colliders, this.preset, this.palette, backend);
    this.scene.add(this.props.group);
    if (async)
      for (const p of this.props.prebuildAsync(st.x, st.z))
        yield { stage: 'loading.props', progress: 0.75 + p * 0.12, wait: true };
    else this.props.prebuild(st.x, st.z);
    yield { stage: 'loading.props', progress: 0.88 };
    const center = new Vector3(0, course.def.baseHeight, 0);
    this.sky = new Sky(
      this.time,
      this.weather,
      this.preset.clouds,
      course.def.seed,
      center,
      course.def.summit.height,
    );
    this.scene.add(this.sky.group);
    this.applyAtmosphereUniforms();
    this.lighting = new Lighting(
      this.scene,
      this.time,
      this.weather,
      this.sky.sunDirection,
      this.preset.shadowMapSize,
      this.preset.shadows,
    );
    this.lighting.follow(new Vector3(st.x, st.y, st.z));
    if (this.weather.snowfall > 0) {
      this.snow = new Snowfall(
        Math.round(this.preset.particles * 0.5 * this.weather.snowfall),
        this.palette.snow[4],
      );
      this.scene.add(this.snow.mesh);
    }
    yield { stage: 'loading.vehicle', progress: 0.94 };
  }

  /** Synchronously builds terrain and props around a point (teleports in tests and tools). */
  prebuildAround(x: number, y: number, z: number): void {
    for (const _ of this.terrainMesh.prebuild(x, y, z)) {
      /* drain */
    }
    this.props.prebuild(x, z);
  }

  /** Whether build() waits for the worker (false: everything on the main thread). */
  private async = true;

  /** Builds everything synchronously (menu background, tests). */
  buildNow(focus?: { x: number; y: number; z: number }): this {
    this.async = false;
    for (const _ of this.build(focus)) {
      /* drain */
    }
    this.async = true;
    return this;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.applyFog();
    this.lighting.setShadows(preset.shadows, preset.shadowMapSize);
    this.props.setQuality(preset);
    // Terrain detail is kept until the next descent: rebuilding every patch mid-run (e.g. on
    // an automatic downgrade) would show coarse ground under the jeep for a while.
  }

  /**
   * @param camera camera world position (streaming, sky)
   * @param focus point of interest (usually the car) for shadows
   */
  update(dt: number, camera: Vector3, focus: Vector3 = camera, buildBudgetMs?: number): void {
    this.elapsed += dt;
    this.applyAtmosphereUniforms();
    atmosphereUniforms.uAtmoCamera.value.copy(camera);
    this.terrainMesh.update(camera.x, camera.y, camera.z, buildBudgetMs);
    this.props.update(camera.x, camera.z, focus.x, focus.z);
    this.sky.update(dt, camera);
    this.lighting.follow(focus);
    this.water.update(dt);
    this.snow?.update(dt, camera, this.elapsed);
  }

  dispose(): void {
    this.disposed = true;
    if (this.farField) {
      this.farField.geometry.dispose();
      (this.farField.material as MeshLambertMaterial).dispose();
      this.farField = null;
    }
    this.terrainMesh?.dispose();
    this.props?.dispose();
    this.structures?.dispose();
    this.sky?.dispose();
    this.water?.dispose();
    this.snow?.dispose();
    this.lighting?.dispose();
    this.colliders.clear();
    this.scene.clear();
  }
}
