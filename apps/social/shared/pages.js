function activePageFromHash() {
  const match = window.location.hash.match(/page=(\d+)/);
  return match ? match[1] : '1';
}

function applyActivePage() {
  const target = activePageFromHash();
  for (const section of document.querySelectorAll('section.page')) {
    section.classList.toggle('is-active', section.dataset.page === target);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyActivePage);
} else {
  applyActivePage();
}

window.addEventListener('hashchange', applyActivePage);
