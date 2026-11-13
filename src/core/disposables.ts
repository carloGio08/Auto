import type { Object3D, Material, BufferGeometry, Texture } from 'three';

type Disposable = { dispose(): void } | (() => void);

/**
 * Collects resources (three.js objects, DOM listeners, event subscriptions) so a state or a
 * session can release everything it created with a single call.
 */
export class Disposables {
  private items: Disposable[] = [];

  add<T extends Disposable>(item: T): T {
    this.items.push(item);
    return item;
  }

  /** Adds a DOM listener and remembers how to remove it. */
  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    fn: (e: never) => void,
    opts?: AddEventListenerOptions,
  ): void {
    const handler = fn as unknown as EventListener;
    target.addEventListener(type, handler, opts);
    this.items.push(() => target.removeEventListener(type, handler, opts));
  }

  dispose(): void {
    // Dispose in reverse creation order.
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (typeof it === 'function') it();
      else it.dispose();
    }
    this.items = [];
  }
}

/** Recursively disposes geometries, materials and textures of an object tree. */
export function disposeObject3D(root: Object3D): void {
  const materials = new Set<Material>();
  const geometries = new Set<BufferGeometry>();
  root.traverse((obj) => {
    const mesh = obj as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => materials.add(m));
      else materials.add(mesh.material);
    }
    const disposable = obj as Object3D & { dispose?: () => void };
    if (typeof disposable.dispose === 'function' && obj.type === 'InstancedMesh') {
      disposable.dispose();
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    for (const value of Object.values(m)) {
      if (value && typeof value === 'object' && (value as Texture).isTexture) {
        (value as Texture).dispose();
      }
    }
    m.dispose();
  });
  root.removeFromParent();
}
