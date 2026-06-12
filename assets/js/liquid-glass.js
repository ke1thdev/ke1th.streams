/**
 * Liquid Glass Displacement Engine v1.0
 * Real glass distortion using SVG feDisplacementMap with chromatic aberration.
 * Based on jhey's glass displacement technique.
 * 
 * Usage: Add class "liquid-glass-displace" to any element that should have the effect.
 * The engine observes element sizes and regenerates displacement maps automatically.
 */
;(function () {
  'use strict';

  // ─── Config ───
  const GLASS_CONFIG = {
    scale: -120,        // displacement intensity
    border: 0.07,       // edge refraction band (fraction of min dimension)
    lightness: 50,      // center neutral zone lightness
    alpha: 0.93,        // center neutral zone opacity
    blur: 11,           // inner blur to soften edges
    blend: 'difference',
    outputBlur: 0.7,    // final output softening
    r: 0,               // chromatic offset red
    g: 10,              // chromatic offset green
    b: 20,              // chromatic offset blue
    xChannel: 'R',
    yChannel: 'G',
    frost: 0.05,
    saturation: 1.5,
  };

  let filterCounter = 0;
  const observedElements = new Map();
  let resizeObserver = null;

  /**
   * Build the SVG displacement image for a given width/height/radius
   */
  function buildDisplacementSVG(w, h, radius) {
    const border = Math.min(w, h) * (GLASS_CONFIG.border * 0.5);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <defs>
        <linearGradient id="lgr" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#000"/>
          <stop offset="100%" stop-color="red"/>
        </linearGradient>
        <linearGradient id="lgb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#000"/>
          <stop offset="100%" stop-color="blue"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h}" fill="black"/>
      <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="url(#lgr)"/>
      <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="url(#lgb)" style="mix-blend-mode:${GLASS_CONFIG.blend}"/>
      <rect x="${border}" y="${border}" width="${w - border * 2}" height="${h - border * 2}" rx="${radius}" fill="hsl(0 0% ${GLASS_CONFIG.lightness}% / ${GLASS_CONFIG.alpha})" style="filter:blur(${GLASS_CONFIG.blur}px)"/>
    </svg>`;
  }

  /**
   * Encode SVG string to data URI for feImage href
   */
  function svgToDataURI(svgString) {
    return 'data:image/svg+xml,' + encodeURIComponent(svgString);
  }

  /**
   * Create a unique SVG filter element for a glass element
   */
  function createFilter(id, w, h, radius) {
    const cfg = GLASS_CONFIG;
    const mapURI = svgToDataURI(buildDisplacementSVG(w, h, radius));

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;');
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS(svgNS, 'defs');
    const filter = document.createElementNS(svgNS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    // feImage — the displacement map
    const feImage = document.createElementNS(svgNS, 'feImage');
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('width', '100%');
    feImage.setAttribute('height', '100%');
    feImage.setAttribute('result', 'map');
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', mapURI);
    feImage.setAttribute('href', mapURI);
    filter.appendChild(feImage);

    // RED channel displacement
    const dispRed = document.createElementNS(svgNS, 'feDisplacementMap');
    dispRed.setAttribute('in', 'SourceGraphic');
    dispRed.setAttribute('in2', 'map');
    dispRed.setAttribute('xChannelSelector', cfg.xChannel);
    dispRed.setAttribute('yChannelSelector', cfg.yChannel);
    dispRed.setAttribute('scale', String(cfg.scale + cfg.r));
    dispRed.setAttribute('result', 'dispRed');
    filter.appendChild(dispRed);

    const cmRed = document.createElementNS(svgNS, 'feColorMatrix');
    cmRed.setAttribute('in', 'dispRed');
    cmRed.setAttribute('type', 'matrix');
    cmRed.setAttribute('values', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0');
    cmRed.setAttribute('result', 'red');
    filter.appendChild(cmRed);

    // GREEN channel displacement
    const dispGreen = document.createElementNS(svgNS, 'feDisplacementMap');
    dispGreen.setAttribute('in', 'SourceGraphic');
    dispGreen.setAttribute('in2', 'map');
    dispGreen.setAttribute('xChannelSelector', cfg.xChannel);
    dispGreen.setAttribute('yChannelSelector', cfg.yChannel);
    dispGreen.setAttribute('scale', String(cfg.scale + cfg.g));
    dispGreen.setAttribute('result', 'dispGreen');
    filter.appendChild(dispGreen);

    const cmGreen = document.createElementNS(svgNS, 'feColorMatrix');
    cmGreen.setAttribute('in', 'dispGreen');
    cmGreen.setAttribute('type', 'matrix');
    cmGreen.setAttribute('values', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0');
    cmGreen.setAttribute('result', 'green');
    filter.appendChild(cmGreen);

    // BLUE channel displacement
    const dispBlue = document.createElementNS(svgNS, 'feDisplacementMap');
    dispBlue.setAttribute('in', 'SourceGraphic');
    dispBlue.setAttribute('in2', 'map');
    dispBlue.setAttribute('xChannelSelector', cfg.xChannel);
    dispBlue.setAttribute('yChannelSelector', cfg.yChannel);
    dispBlue.setAttribute('scale', String(cfg.scale + cfg.b));
    dispBlue.setAttribute('result', 'dispBlue');
    filter.appendChild(dispBlue);

    const cmBlue = document.createElementNS(svgNS, 'feColorMatrix');
    cmBlue.setAttribute('in', 'dispBlue');
    cmBlue.setAttribute('type', 'matrix');
    cmBlue.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0');
    cmBlue.setAttribute('result', 'blue');
    filter.appendChild(cmBlue);

    // Blend RGB channels back together
    const blendRG = document.createElementNS(svgNS, 'feBlend');
    blendRG.setAttribute('in', 'red');
    blendRG.setAttribute('in2', 'green');
    blendRG.setAttribute('mode', 'screen');
    blendRG.setAttribute('result', 'rg');
    filter.appendChild(blendRG);

    const blendRGB = document.createElementNS(svgNS, 'feBlend');
    blendRGB.setAttribute('in', 'rg');
    blendRGB.setAttribute('in2', 'blue');
    blendRGB.setAttribute('mode', 'screen');
    blendRGB.setAttribute('result', 'output');
    filter.appendChild(blendRGB);

    // Final subtle gaussian blur on output
    const gaussBlur = document.createElementNS(svgNS, 'feGaussianBlur');
    gaussBlur.setAttribute('in', 'output');
    gaussBlur.setAttribute('stdDeviation', String(cfg.outputBlur));
    filter.appendChild(gaussBlur);

    defs.appendChild(filter);
    svg.appendChild(defs);

    return svg;
  }

  /**
   * Get the computed border-radius of an element (simplified to a single value)
   */
  function getRadius(el) {
    const cs = getComputedStyle(el);
    const r = parseFloat(cs.borderRadius) || 0;
    return r;
  }

  /**
   * Apply or update a displacement filter on a single element
   */
  function applyGlass(el) {
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 2 || h < 2) return; // element not visible yet

    const radius = getRadius(el);
    let data = observedElements.get(el);

    // Check if dimensions changed
    if (data && data.w === w && data.h === h && data.r === radius) return;

    const filterId = data ? data.filterId : `lg-glass-${filterCounter++}`;

    // Remove old SVG if exists
    if (data && data.svgEl) {
      data.svgEl.remove();
    }

    // Create fresh filter
    const svgEl = createFilter(filterId, w, h, radius);
    document.body.appendChild(svgEl);

    // Apply to element via backdrop-filter
    const filterRef = `url(#${filterId})`;
    el.style.backdropFilter = `${filterRef} blur(4px) saturate(${GLASS_CONFIG.saturation}) brightness(1.1)`;
    el.style.webkitBackdropFilter = `${filterRef} blur(4px) saturate(${GLASS_CONFIG.saturation}) brightness(1.1)`;

    // Also apply to child .glass-overlay and .glass-filter if they exist
    const overlay = el.querySelector(':scope > .glass-overlay');
    if (overlay) {
      overlay.style.backdropFilter = filterRef;
      overlay.style.webkitBackdropFilter = filterRef;
    }
    const glassFilter = el.querySelector(':scope > .glass-filter');
    if (glassFilter) {
      glassFilter.style.backdropFilter = `${filterRef} blur(4px) saturate(${GLASS_CONFIG.saturation})`;
      glassFilter.style.webkitBackdropFilter = `${filterRef} blur(4px) saturate(${GLASS_CONFIG.saturation})`;
    }

    observedElements.set(el, { filterId, svgEl, w, h, r: radius });
  }

  /**
   * Initialize displacement on all qualifying glass elements
   */
  function initGlass() {
    // Target all glass containers and shorthand classes
    const selectors = [
      '.glass-container',
      '.liquid-glass-bar',
      '.liquid-glass',
      '.liquid-glass-circle',
      '.topbar-inner',
    ];

    const allEls = document.querySelectorAll(selectors.join(','));

    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(function (entries) {
        for (const entry of entries) {
          applyGlass(entry.target);
        }
      });
    }

    allEls.forEach(function (el) {
      if (observedElements.has(el)) return;
      applyGlass(el);
      resizeObserver.observe(el);
    });
  }

  // Run on DOMContentLoaded + small delay to ensure layout is settled
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(function () { setTimeout(initGlass, 100); });
    });
  } else {
    requestAnimationFrame(function () { setTimeout(initGlass, 100); });
  }

  // Re-scan after any dynamic content loads
  window.addEventListener('load', function () {
    setTimeout(initGlass, 300);
  });

  // Expose for manual re-initialization if needed
  window.LiquidGlass = { init: initGlass, apply: applyGlass };
})();
