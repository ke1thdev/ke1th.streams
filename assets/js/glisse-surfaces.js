import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Glass } from 'glisse';

export function mountGlisseSurfaces() {
  const selector = '[data-glisse-surface]';
  const roots = new WeakMap();
  function unmount(target) {
    const mounted = roots.get(target);
    if (!mounted) return;
    roots.delete(target);
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
      const layer = document.createElement('span');
      layer.className = 'glisse-surface-layer';
      layer.setAttribute('aria-hidden', 'true');
      target.prepend(layer);
      const root = createRoot(layer);
      roots.set(target, { root, layer });
      root.render(createElement(Glass, { 'data-theme': 'dark' }));
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
