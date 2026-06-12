// Pjax Router to make page transitions instantaneous
document.addEventListener('click', async (e) => {
  const link = e.target.closest('a');
  
  if (!link) return;
  
  // Only intercept same-origin links
  if (link.origin !== window.location.origin) return;
  
  // Ignore links that open in a new tab, or have hash
  if (link.target === '_blank' || link.hash) return;
  
  // Prevent default hard navigation
  e.preventDefault();
  
  const url = link.href;
  
  // Don't navigate if we're already on the same exact URL (ignoring hash)
  if (url === window.location.href.split('#')[0]) return;
  
  // Add an active/loading state if needed, or we can just instantly clear main and show a skeleton if we had one.
  // Actually, fetching is so fast on same-origin we just wait.
  
  // Push state to history
  history.pushState(null, '', url);
  
  await loadPage(url);
});

// Handle browser back/forward buttons
window.addEventListener('popstate', () => {
  loadPage(window.location.href);
});

async function loadPage(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      window.location.href = url; // fallback to hard navigation on error
      return;
    }
    
    const htmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    
    // Update Document Title
    document.title = doc.title;
    
    // Swap Body Content and classes
    document.body.className = doc.body.className;
    document.body.innerHTML = doc.body.innerHTML;
    
    // Re-execute scripts
    const scripts = document.body.querySelectorAll('script');
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      // Copy all attributes
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      // Copy inline text
      if (oldScript.textContent) {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
    
    // Re-trigger DOMContentLoaded so all page-specific JS initializes
    window.document.dispatchEvent(new Event('DOMContentLoaded', {
      bubbles: true,
      cancelable: true
    }));
    
    // Scroll to top
    window.scrollTo(0, 0);
    
  } catch (err) {
    // Fallback on network failure
    window.location.href = url;
  }
}
