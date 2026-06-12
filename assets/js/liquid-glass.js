/**
 * Liquid Glass Displacement Engine v2.0
 * 
 * Chromium: Real SVG feDisplacementMap with chromatic aberration
 * Safari/WebKit: Apple-style liquid glass with heavy blur, saturation, and refraction simulation
 * 
 * The engine auto-detects the browser and applies the best possible glass effect.
 */
;(function () {
  'use strict';

  // ─── Browser Detection ───
  const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const isChromium = /Chrome/.test(navigator.userAgent) && /AppleWebKit/.test(navigator.userAgent);

  // Tag the document so CSS can branch
  document.documentElement.dataset.glassEngine = isChromium ? 'chromium' : 'webkit';

  // ─── Config ───
  const GLASS_CONFIG = {
    scale: -120,
    border: 0.07,
    lightness: 50,
    alpha: 0.93,
    blur: 11,
    blend: 'difference',
    outputBlur: 0.7,
    r: 0,
    g: 10,
    b: 20,
    xChannel: 'R',
    yChannel: 'G',
    frost: 0.05,
    saturation: 1.5,
  };

  // Apple-style glass parameters for Safari
  const SAFARI_GLASS = {
    blur: 8,           // Very light blur so background elements are highly visible
    saturate: 1.2,     // Natural color saturation
    brightness: 1.02,  // Almost no brightness lift
    contrast: 1.02,    // Almost no contrast boost
  };

  let filterCounter = 0;
  const observedElements = new Map();
  let resizeObserver = null;

  // ─── Selectors for glass elements ───
  const GLASS_SELECTORS = [
    '.glass-container',
    '.liquid-glass-bar',
    '.liquid-glass',
    '.liquid-glass-circle',
    '.topbar-inner',
  ];

  // ═══════════════════════════════════════════
  // SAFARI / WEBKIT PATH — Apple Liquid Glass
  // ═══════════════════════════════════════════

  function applySafariGlass(el) {
    const s = SAFARI_GLASS;
    const bdf = `blur(${s.blur}px) saturate(${s.saturate}) brightness(${s.brightness}) contrast(${s.contrast})`;

    // Apply to the element itself
    el.style.webkitBackdropFilter = bdf;
    el.style.backdropFilter = bdf;

    // If it has the layered glass structure, apply to .glass-filter child
    const glassFilter = el.querySelector(':scope > .glass-filter');
    if (glassFilter) {
      glassFilter.style.webkitBackdropFilter = bdf;
      glassFilter.style.backdropFilter = bdf;
    }

    // Remove overlay backdrop-filter (just use tint)
    const overlay = el.querySelector(':scope > .glass-overlay');
    if (overlay) {
      overlay.style.webkitBackdropFilter = 'none';
      overlay.style.backdropFilter = 'none';
    }

    // Mark as processed
    el.classList.add('lg-safari-glass');
  }

  function initSafariGlass() {
    const allEls = document.querySelectorAll(GLASS_SELECTORS.join(','));
    allEls.forEach(applySafariGlass);
  }

  // ═══════════════════════════════════════════
  // CHROMIUM PATH — SVG Displacement Engine
  // ═══════════════════════════════════════════

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

  function svgToDataURI(svgString) {
    return 'data:image/svg+xml,' + encodeURIComponent(svgString);
  }

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

    const feImage = document.createElementNS(svgNS, 'feImage');
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('width', '100%');
    feImage.setAttribute('height', '100%');
    feImage.setAttribute('result', 'map');
    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', mapURI);
    feImage.setAttribute('href', mapURI);
    filter.appendChild(feImage);

    // RED channel
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

    // GREEN channel
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

    // BLUE channel
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

    // Blend
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

    // Final blur
    const gaussBlur = document.createElementNS(svgNS, 'feGaussianBlur');
    gaussBlur.setAttribute('in', 'output');
    gaussBlur.setAttribute('stdDeviation', String(cfg.outputBlur));
    filter.appendChild(gaussBlur);

    defs.appendChild(filter);
    svg.appendChild(defs);
    return svg;
  }

  function getRadius(el) {
    return parseFloat(getComputedStyle(el).borderRadius) || 0;
  }

  function applyChromiumGlass(el) {
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 2 || h < 2) return;

    const radius = getRadius(el);
    let data = observedElements.get(el);
    if (data && data.w === w && data.h === h && data.r === radius) return;

    const filterId = data ? data.filterId : `lg-glass-${filterCounter++}`;
    if (data && data.svgEl) data.svgEl.remove();

    const svgEl = createFilter(filterId, w, h, radius);
    document.body.appendChild(svgEl);

    const filterRef = `url(#${filterId})`;
    el.style.backdropFilter = `${filterRef} blur(4px) saturate(${GLASS_CONFIG.saturation}) brightness(1.1)`;
    el.style.webkitBackdropFilter = `${filterRef} blur(4px) saturate(${GLASS_CONFIG.saturation}) brightness(1.1)`;

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

  function initChromiumGlass() {
    const allEls = document.querySelectorAll(GLASS_SELECTORS.join(','));

    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(function (entries) {
        for (const entry of entries) {
          applyChromiumGlass(entry.target);
        }
      });
    }

    allEls.forEach(function (el) {
      if (observedElements.has(el)) return;
      applyChromiumGlass(el);
      resizeObserver.observe(el);
    });
  }

  // ═══════════════════════════════════════════
  // INIT — route to the right engine
  // ═══════════════════════════════════════════

  function initGlass() {
    if (isChromium) {
      initChromiumGlass();
    } else {
      initSafariGlass();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(function () { setTimeout(initGlass, 100); });
    });
  } else {
    requestAnimationFrame(function () { setTimeout(initGlass, 100); });
  }

  window.addEventListener('load', function () {
    setTimeout(initGlass, 300);
  });

  window.LiquidGlass = { init: initGlass, apply: isChromium ? applyChromiumGlass : applySafariGlass };
})();
