import { Color, Fog, Scene, Vector3, type Texture } from 'three';
import type { QualityPreset } from '../config';
import type { TimeOfDayDef, WeatherDef } from '../data/types';
import type { I18nKey } from '../i18n/en';
import type { Course } from '../terrain/course';
import { buildRoadMeshes } from '../terrain/roadMesh';
import { TerrainMesh } from '../terrain/terrainMesh';
import {
  createCheckerTexture,
  createParticleTexture,
  createPlankTexture,
  createRoadTexture,
  createTerrainDetailTexture,
} from '../terrain/textures';
import { CollisionWorld } from './colliders';
import { Lighting } from './lighting';
import { Props } from './props';
import { Sky } from './sky';
import { Structures } from './structures';
import { Water } from './water';
import { Snowfall } from './weather';
import { disposeObject3D } from '../core/disposables';
import type { Group } from 'three';

export interface WorldOptions {
  course: Course;
  time: TimeOfDayDef;
  weather: WeatherDef;
  preset: QualityPreset;
}

export interface BuildStep {
  stage: I18nKey;
  progress: number;
}

/**
 * Everything static in a level: terrain, road, props, structures, sky, water, weather and
 * lights. Built incrementally (generator) so the loading screen can show progress.
 */
export class World {
  readonly scene = new Scene();
  readonly colliders = new CollisionWorld();
  readonly course: Course;
  readonly time: TimeOfDayDef;
  readonly weather: WeatherDef;
  preset: QualityPreset;
  readonly textures: {
    detail: Texture;
    road: Texture;
    plank: Texture;
    particle: Texture;
    checker: Texture;
  };
  terrainMesh!: TerrainMesh;
  roadGroup!: Group;
  props!: Props;
  structures!: Structures;
  sky!: Sky;
  lighting!: Lighting;
  water!: Water;
  snow: Snowfall | null = null;
  readonly fogColor: Color;
  private elapsed = 0;
  private readonly focus = new Vector3();

  constructor(opts: WorldOptions) {
    this.course = opts.course;
    this.time = opts.time;
    this.weather = opts.weather;
    this.preset = opts.preset;
    this.textures = {
      detail: createTerrainDetailTexture(),
      road: createRoadTexture(),
      plank: createPlankTexture(),
      particle: createParticleTexture(),
      checker: createCheckerTexture(),
    };
    this.fogColor = new Color(this.time.fogColor).lerp(
      new Color('#a7b0ba'),
      this.weather.overcast * 0.6,
    );
    this.scene.background = this.fogColor.clone();
    this.applyFog();
  }

  private applyFog(): void {
    const far = this.preset.viewDistance / this.weather.fogDensity;
    this.scene.fog = new Fog(this.fogColor, Math.min(60, far * 0.15), far);
  }

  /** Incremental build; iterate to completion. */
  *build(): Generator<BuildStep> {
    const course = this.course;
    yield { stage: 'loading.terrain', progress: 0.05 };
    this.terrainMesh = new TerrainMesh(course.terrain, this.textures.detail);
    this.scene.add(this.terrainMesh.group);
    for (const p of this.terrainMesh.buildAll())
      yield { stage: 'loading.terrain', progress: 0.05 + p * 0.35 };
    const start = course.road.pointAt(course.startS, {
      x: 0,
      y: 0,
      z: 0,
      tx: 0,
      tz: 1,
      halfWidth: 5,
      s: 0,
      index: 0,
    });
    this.terrainMesh.prebuildAround(start.x, start.z);
    yield { stage: 'loading.road', progress: 0.5 };
    this.roadGroup = buildRoadMeshes(course, this.textures.road, this.textures.plank);
    this.scene.add(this.roadGroup);
    this.water = new Water(course, this.time.skyHorizon);
    this.scene.add(this.water.group);
    yield { stage: 'loading.props', progress: 0.6 };
    this.props = new Props(course, this.colliders, this.preset);
    this.props.build();
    this.scene.add(this.props.group);
    yield { stage: 'loading.props', progress: 0.8 };
    this.structures = new Structures(course, this.colliders, this.textures.checker);
    this.structures.build();
    this.scene.add(this.structures.group);
    const center = new Vector3(
      0,
      course.mountain.def.lakeLevel,
      (course.road.bounds.minZ + course.road.bounds.maxZ) / 2,
    );
    this.sky = new Sky(this.time, this.weather, this.preset.clouds, course.track.seed, center);
    this.scene.add(this.sky.group);
    this.lighting = new Lighting(
      this.scene,
      this.time,
      this.weather,
      this.sky.sunDirection,
      this.preset.shadowMapSize,
      this.preset.shadows,
    );
    this.lighting.follow(new Vector3(start.x, start.y, start.z));
    if (this.weather.snowfall > 0) {
      this.snow = new Snowfall(
        Math.round(this.preset.particles * 0.9 * this.weather.snowfall),
        this.textures.particle,
      );
      this.scene.add(this.snow.points);
    }
    this.props.update(start.x, start.z);
    yield { stage: 'loading.vehicle', progress: 0.9 };
  }

  /** Builds everything synchronously (menu background, tests). */
  buildNow(): this {
    for (const _ of this.build()) {
      /* drain */
    }
    return this;
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    this.applyFog();
    this.lighting.setShadows(preset.shadows, preset.shadowMapSize);
    this.props.setShadows(preset.shadows);
  }

  /**
   * @param camera camera world position (streaming, sky)
   * @param focus point of interest (usually the car) for shadows
   */
  update(dt: number, camera: Vector3, focus: Vector3 = camera, buildBudgetMs?: number): void {
    this.elapsed += dt;
    this.focus.copy(focus);
    this.terrainMesh.update(camera.x, camera.z, buildBudgetMs, this.preset.viewDistance);
    this.props.update(camera.x, camera.z);
    this.sky.update(dt, camera);
    this.lighting.follow(focus);
    this.water.update(dt);
    this.snow?.update(dt, camera, this.elapsed);
  }

  dispose(): void {
    this.terrainMesh?.dispose();
    this.props?.dispose();
    this.structures?.dispose();
    this.sky?.dispose();
    this.water?.dispose();
    this.snow?.dispose();
    this.lighting?.dispose();
    if (this.roadGroup) disposeObject3D(this.roadGroup);
    Object.values(this.textures).forEach((t) => t.dispose());
    this.colliders.clear();
    this.scene.clear();
  }
}
