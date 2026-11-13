/** Device capabilities detected once at boot. */
export interface DeviceInfo {
  touch: boolean;
  mobile: boolean;
  ios: boolean;
  lowEnd: boolean;
  standalone: boolean;
}

export function detectDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile =
    ios || /Android|Mobi/i.test(ua) || (touch && Math.min(screen.width, screen.height) < 820);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { touch, mobile, ios, lowEnd: cores <= 4 && mem <= 3, standalone };
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
