import type { GameContext, StateId } from '../core/context';
import type { GameState } from '../core/stateMachine';
import { GarageScene } from '../game/garageScene';
import { createGarage } from '../ui/screens/garage';

export class GarageState implements GameState<StateId> {
  readonly id = 'garage' as const;
  private scene!: GarageScene;
  private readonly onResize = (): void =>
    this.scene.resize(this.ctx.renderer.width / this.ctx.renderer.height);

  constructor(private readonly ctx: GameContext) {}

  enter(): void {
    const ctx = this.ctx;
    this.scene = new GarageScene(ctx.renderer.width / ctx.renderer.height, ctx.renderer.canvas);
    ctx.view = { scene: this.scene.scene, camera: this.scene.camera };
    window.addEventListener('resize', this.onResize);
    ctx.ui.setScreen(
      createGarage(ctx, {
        onBack: () => ctx.states.go('mainMenu'),
        preview: (car, color) => this.scene.setCar(car, color),
        recolor: (color) => this.scene.setColor(color),
      }),
    );
  }

  update(dt: number): void {
    this.scene.update(dt);
  }

  exit(): void {
    window.removeEventListener('resize', this.onResize);
    this.ctx.ui.setScreen(null);
    this.ctx.view = null;
    this.scene.dispose();
  }
}
