import { createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Glass, TabBar } from 'glisse';
import { mountDockBackdrop } from './dock-backdrop.js';
import { glassPlateStyle, mountGlisseSurfaces } from './glisse-surfaces.js';

const mobile = matchMedia('(max-width: 980px)');
const nativeRefraction = /Chrom(?:e|ium)\//.test(navigator.userAgent);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

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

function DockTabBar({ handoff, ...props }) {
  useLayoutEffect(handoff, [handoff]);
  return createElement(TabBar, props);
}

function DockSurface({ control }) {
  useLayoutEffect(() => {
    control.setAttribute('data-glisse-dock-ready', '');
    return () => control.removeAttribute('data-glisse-dock-ready');
  }, [control]);
  return createElement(Glass, {
    className: 'glisse-dock-surface',
    'data-theme': 'dark',
    'aria-hidden': true,
    style: glassPlateStyle
  });
}

function mountRestingGlass(wrapper, nav, searchButton) {
  const controls = [nav, searchButton].filter(Boolean);
  const roots = controls.map(control => createRoot(control.querySelector('.glass-filter')));
  mountDockBackdrop(wrapper, nav, ready => {
    controls.forEach((control, index) => {
      roots[index].render(ready ? createElement(DockSurface, { control }) : null);
    });
  });
}

function mountDock() {
  const wrapper = document.querySelector('.mobile-dock-wrapper');
  const fallback = wrapper?.querySelector('.mobile-dock');
  if (!fallback) return;

  const links = Array.from(fallback.querySelectorAll('.dock-btn'));
  const items = links.map((link, index) => ({
    value: String(index),
    label: link.textContent.trim(),
    href: link.getAttribute('href') || './',
    icon: svgIcon(link.querySelector('svg'))
  }));

  const activeIndex = links.findIndex(link => link.classList.contains('dock-active'));
  const home = activeIndex === 0;
  const anime = activeIndex === 1 && new URLSearchParams(location.search).get('type') === 'anime';
  const searchButton = wrapper.querySelector('.dock-search-btn');

  if (!nativeRefraction) {
    const selected = anime ? 2 : activeIndex;
    links.forEach((link, index) => {
      link.classList.toggle('dock-active', index === selected);
      if (index === selected) link.setAttribute('aria-current', 'page');
    });
    if (!reducedMotion.matches) mountRestingGlass(wrapper, fallback, searchButton);
    return;
  }

  const slot = document.createElement('div');
  slot.className = 'glisse-dock-slot';
  slot.style.display = 'none';
  wrapper.prepend(slot);

  createRoot(slot).render(createElement(DockTabBar, {
    handoff() {
      fallback.hidden = true;
      fallback.style.display = 'none';
      slot.style.display = 'flex';
      return () => {
        slot.style.display = 'none';
        fallback.hidden = false;
        fallback.style.removeProperty('display');
      };
    },
    'aria-label': 'Mobile navigation',
    'data-theme': 'dark',
    style: {
      '--lg-tab-width': 'var(--dock-tab-width, 54px)',
      '--lg-tab-height': 'var(--dock-tab-height, 46px)',
      '--lg-tab-inset': 'var(--dock-inset, 4px)'
    },
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

  const searchSurface = searchButton?.querySelector('.glass-filter');
  if (searchSurface) {
    createRoot(searchSurface).render(createElement(DockSurface, { control: searchButton }));
  }
}

function enhanceMobileDock() {
  if (!mobile.matches) return;
  mobile.removeEventListener('change', enhanceMobileDock);
  mountDock();
}

if (!nativeRefraction) document.documentElement.classList.add('glass-economy');
mobile.addEventListener('change', enhanceMobileDock);
enhanceMobileDock();
if (nativeRefraction) mountGlisseSurfaces();
