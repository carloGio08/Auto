/**
 * Cheap screen effects done in CSS (no extra render passes): vignette, coloured flashes,
 * and nitro edge glow.
 */
export class PostFx {
  readonly root: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly nitro: HTMLDivElement;
  private flashLevel = 0;
  private nitroLevel = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'postfx';
    this.root.innerHTML =
      '<div class="fx-vignette"></div><div class="fx-nitro"></div><div class="fx-flash"></div>';
    parent.append(this.root);
    this.flash = this.root.querySelector('.fx-flash') as HTMLDivElement;
    this.nitro = this.root.querySelector('.fx-nitro') as HTMLDivElement;
  }

  doFlash(color: string, strength: number): void {
    this.flash.style.background = color;
    this.flashLevel = Math.min(1, Math.max(this.flashLevel, strength));
  }

  update(dt: number, nitro: boolean): void {
    this.flashLevel = Math.max(0, this.flashLevel - dt * 3);
    this.flash.style.opacity = this.flashLevel.toFixed(3);
    this.nitroLevel += ((nitro ? 1 : 0) - this.nitroLevel) * Math.min(1, dt * 8);
    this.nitro.style.opacity = this.nitroLevel.toFixed(3);
  }

  dispose(): void {
    this.root.remove();
  }
}
