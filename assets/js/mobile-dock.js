import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Glass, TabBar } from 'glisse';
import { mountDockBackdrop } from './dock-backdrop.js';
import { mountGlisseSurfaces } from './glisse-surfaces.js';

const mobile = matchMedia('(max-width: 980px)');

function svgIcon(source) {
  return createElement('svg', {
    viewBox: source.getAttribute('viewBox'),
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  }, Array.from(source.children, (shape, key) => createElement(shape.localName, {
    ...Object.fromEntries(Array.from(shape.attributes, ({ name, value }) => [name, value])),
    key
  })));
}

function mountDock() {
  const wrapper = document.querySelector('.mobile-dock-wrapper');
  if (!wrapper) return;

  const links = Array.from(wrapper.querySelectorAll('.dock-btn'));
  const items = links.map((link, index) => ({
    value: String(index),
    label: link.textContent.trim(),
    href: link.getAttribute('href') || './',
    icon: svgIcon(link.querySelector('svg'))
  }));

  const activeIndex = links.findIndex(link => link.classList.contains('dock-active'));
  const home = activeIndex === 0;
  const anime = activeIndex === 1 && new URLSearchParams(location.search).get('type') === 'anime';
  const slot = document.createElement('div');
  slot.className = 'glisse-dock-slot';
  wrapper.prepend(slot);

  // Match Glisse's live-backdrop check so both dock lenses use the same path.
  if (!/Chrom(?:e|ium)\//.test(navigator.userAgent)) mountDockBackdrop(wrapper, slot);

  createRoot(slot).render(createElement(TabBar, {
    'aria-label': 'Mobile navigation',
    'data-theme': 'dark',
    items,
    defaultValue: anime ? '2' : activeIndex < 0 ? null : String(activeIndex),
    onClick(event) {
      const link = event.target.closest('a');
      if (!home || link?.getAttribute('href') !== './' ||
          event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      window.scrollTo({ top: 0, behavior });
    }
  }));

  const searchSurface = wrapper.querySelector('.dock-search-btn .glass-filter');
  if (searchSurface) {
    createRoot(searchSurface).render(createElement(Glass, {
      className: 'glisse-dock-search-surface',
      'data-theme': 'dark',
      'aria-hidden': true
    }));
  }
}

function enhanceMobileDock() {
  if (!mobile.matches) return;
  mobile.removeEventListener('change', enhanceMobileDock);
  mountDock();
}

mobile.addEventListener('change', enhanceMobileDock);
enhanceMobileDock();
mountGlisseSurfaces();
