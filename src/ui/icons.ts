/** Inline SVG icons (stroke = currentColor). Trusted constant markup. */
const svg = (body: string, vb = '0 0 24 24'): string =>
  `<svg viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons: Record<string, string> = {
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  garage: svg('<path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-7h10v7"/><path d="M7 17h10"/>'),
  map: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  calendar: svg(
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 15h3"/>',
  ),
  trophy: svg(
    '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 6h3a3 3 0 01-3 4M7 6H4a3 3 0 003 4"/>',
  ),
  settings: svg(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
  ),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  reset: svg('<path d="M3 12a9 9 0 109-9 9.5 9.5 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/>'),
  camera: svg(
    '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  ),
  fullscreen: svg(
    '<path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>',
  ),
  soundOn: svg(
    '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>',
  ),
  soundOff: svg('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
  coin: svg(
    '<circle cx="12" cy="12" r="9" fill="#ffcf3f" stroke="#b8860b"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" stroke="#8a6200"/>',
  ),
  crystal: svg(
    '<path d="M12 2l6 7-6 13-6-13z" fill="#7fe7ff" stroke="#2ab0d6"/><path d="M6 9h12M12 2v20" stroke="#2ab0d6"/>',
  ),
  medal: svg('<circle cx="12" cy="15" r="6"/><path d="M8.5 10L6 2h4l2 5 2-5h4l-2.5 8"/>'),
  flag: svg('<path d="M4 22V3"/><path d="M4 3h14l-3 4 3 4H4"/>'),
  wing: svg('<path d="M2 16c6-1 10-5 12-12 2 6 1 12-4 16-3 2-6 1-8-4z"/>'),
  flip: svg('<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/>'),
  drift: svg(
    '<path d="M3 17c4 0 4-4 8-4s4 4 8 4"/><path d="M3 11c4 0 4-4 8-4s4 4 8 4" opacity=".6"/>',
  ),
  star: svg('<path d="M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5L5.5 21l2-7.5L2 9h7z"/>'),
  tree: svg('<path d="M12 2l6 9h-3l4 6H5l4-6H6z"/><path d="M12 17v5"/>'),
  nitro: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/>'),
  left: svg('<path d="M15 4l-8 8 8 8" stroke-width="3"/>'),
  right: svg('<path d="M9 4l8 8-8 8" stroke-width="3"/>'),
  gas: svg(
    '<path d="M12 4v12M6 10l6-6 6 6" stroke-width="3"/><path d="M5 20h14" stroke-width="3"/>',
  ),
  brake: svg(
    '<path d="M12 20V8M6 14l6 6 6-6" stroke-width="3"/><path d="M5 4h14" stroke-width="3"/>',
  ),
  drift2: svg(
    '<path d="M4 18c3-6 6-9 10-9h6" stroke-width="2.5"/><path d="M16 5l4 4-4 4" stroke-width="2.5"/>',
  ),
  arrowUp: svg('<path d="M12 3l7 9h-4.5v9h-5v-9H5z" fill="currentColor" stroke="none"/>'),
  check: svg('<path d="M4 12l5 5L20 6"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  car: svg(
    '<path d="M3 13l2-5h14l2 5v5H3z"/><circle cx="7.5" cy="18" r="2" fill="currentColor"/><circle cx="16.5" cy="18" r="2" fill="currentColor"/><path d="M3 13h18"/>',
  ),
};

export const icon = (name: string): string => icons[name] ?? icons.info;
