/* A rounded lens with edge-only refraction. CSS supplies the frost and rim on other engines. */
(() => {
  'use strict';

  const chromium = /Chrome\/\d+/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent);
  if (!chromium || !CSS.supports('backdrop-filter', 'url(#lens)') || !window.ResizeObserver) return;

  const targets = '.glass-container, .topbar-inner, .liquid-glass-input, .liquid-glass-bar, .liquid-glass-circle, .liquid-glass';
  const desktop = matchMedia('(min-width: 981px)');
  const ns = 'http://www.w3.org/2000/svg';
  const filters = new WeakMap();
  let nextId = 0;

  function svgElement(tag, attributes) {
    const element = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  function makeMap(width, height, radius) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const map = ctx.createImageData(width, height);
    const bevel = Math.min(radius, 14);

    for (let y = 0, i = 0; y < height; y++) {
      const dy = y + 0.5 - height / 2;
      const qy = Math.abs(dy) - (height / 2 - radius);

      for (let x = 0; x < width; x++, i += 4) {
        const dx = x + 0.5 - width / 2;
        const qx = Math.abs(dx) - (width / 2 - radius);
        const cornerX = Math.max(qx, 0);
        const cornerY = Math.max(qy, 0);
        const corner = Math.hypot(cornerX, cornerY);
        // Signed distance to a rounded rectangle, measured inward from its rim.
        const depth = radius - corner - Math.min(Math.max(qx, qy), 0);
        const edge = Math.max(0, 1 - Math.max(depth, 0) / bevel);
        const nx = corner ? cornerX / corner : Number(qx > qy);
        const ny = corner ? cornerY / corner : Number(qy >= qx);
        const bend = 76 * edge ** 2;
        map.data[i] = 128 - Math.sign(dx) * nx * bend;
        map.data[i + 1] = 128 - Math.sign(dy) * ny * bend;
        map.data[i + 3] = 255;
      }
    }

    ctx.putImageData(map, 0, 0);
    return canvas.toDataURL();
  }

  function updateLens(element) {
    const surface = element.querySelector(':scope > .glass-filter') || element;
    const width = surface.offsetWidth;
    const height = surface.offsetHeight;
    const radius = Math.min(parseFloat(getComputedStyle(surface).borderTopLeftRadius) || 0, width / 2, height / 2);
    const previous = filters.get(element);

    if (previous?.width === width && previous.height === height && previous.radius === radius) return;
    if (previous) {
      previous.svg.remove();
      surface.style.removeProperty('--glass-lens');
      filters.delete(element);
    }
    if (radius < 4 || width < 16 || height < 16) return;

    const href = makeMap(width, height, radius);
    if (!href) return;

    const id = 'stream-glass-' + nextId++;
    const svg = svgElement('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute;pointer-events:none' });
    const filter = svgElement('filter', {
      id, x: 0, y: 0, width, height, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB'
    });
    filter.append(
      svgElement('feImage', { href, x: 0, y: 0, width, height, result: 'lens' }),
      svgElement('feDisplacementMap', { in: 'SourceGraphic', in2: 'lens', scale: 28, xChannelSelector: 'R', yChannelSelector: 'G' })
    );
    const defs = svgElement('defs', {});
    defs.append(filter);
    svg.append(defs);
    document.body.append(svg);
    surface.style.setProperty('--glass-lens', 'blur(3px) url(#' + id + ') saturate(1.25)');
    filters.set(element, { svg, width, height, radius });
  }

  const observer = new ResizeObserver(entries => {
    for (const { target } of entries) updateLens(target);
  });

  function init() {
    for (const element of document.querySelectorAll(targets)) {
      if (element.closest('.mobile-dock-wrapper') || element.hasAttribute('data-glisse-surface')) continue;
      if (element.matches('.topbar-inner') && !desktop.matches) continue;
      observer.observe(element);
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
  desktop.addEventListener('change', init);
})();
