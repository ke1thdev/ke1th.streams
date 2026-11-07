import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Glass } from 'glisse';

// Keep the plate inside its control even during a stylesheet update.
export const glassPlateStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  borderRadius: 'inherit',
  pointerEvents: 'none'
};

export function mountGlisseSurfaces() {
  const selector = '[data-glisse-surface]';
  const roots = new WeakMap();
  function unmount(target) {
    const mounted = roots.get(target);
    if (!mounted) return;
    roots.delete(target);
    target.removeAttribute('data-glisse-ready');
    mounted.root.unmount();
    mounted.layer.remove();
  }

  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) {
        unmount(target);
        continue;
      }
      if (!target.isConnected || roots.has(target)) continue;
      if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
      const layer = document.createElement('span');
      layer.className = 'glisse-surface-layer';
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, glassPlateStyle, { overflow: 'hidden', zIndex: '-1' });
      target.prepend(layer);

      const control = target.getBoundingClientRect();
      const plate = layer.getBoundingClientRect();
      if (!plate.width || !plate.height || plate.left < control.left - 1 || plate.top < control.top - 1 ||
          plate.right > control.right + 1 || plate.bottom > control.bottom + 1) {
        layer.remove();
        continue;
      }
      const root = createRoot(layer);
      roots.set(target, { root, layer });
      target.setAttribute('data-glisse-ready', '');
      root.render(createElement(Glass, { 'data-theme': 'dark', style: glassPlateStyle }));
    }
  }, { rootMargin: '80px' });

  function visit(node, action) {
    if (!(node instanceof Element)) return;
    if (node.matches(selector)) action(node);
    node.querySelectorAll(selector).forEach(action);
  }

  const observe = node => {
    if (!roots.has(node)) observer.observe(node);
  };
  const cleanup = node => {
    if (node.isConnected) return;
    observer.unobserve(node);
    unmount(node);
  };

  visit(document.body, observe);
  new MutationObserver(records => {
    for (const record of records) {
      record.removedNodes.forEach(node => visit(node, cleanup));
      record.addedNodes.forEach(node => visit(node, observe));
    }
  }).observe(document.body, { childList: true, subtree: true });
}
