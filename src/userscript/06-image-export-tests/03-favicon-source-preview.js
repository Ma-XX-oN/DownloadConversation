  /** Exact reference URLs observed in the October 2026 favicon logs. */
  const FAVICON_PREVIEW_REFERENCE = Object.freeze([
    { key: 'light-svg', label: 'Light SVG', file: /^favicon\.[^/]+\.svg$/i,
      url: 'https://chatgpt.com/cdn/assets/favicon.6a33781f61.svg' },
    { key: 'dark-svg', label: 'Dark SVG', file: /^favicon-dark\.[^/]+\.svg$/i,
      url: 'https://chatgpt.com/cdn/assets/favicon-dark.cdf009c235.svg' },
    { key: 'png', label: '48×48 PNG', file: /^favicon-48x48\.[^/]+\.png$/i,
      url: 'https://chatgpt.com/cdn/assets/favicon-48x48.7d42b2e65f.png' }
  ]);

  /**
   * Finds a live stock asset or retains the exact logged reference as fallback.
   * @returns {Array<Object>} Three source URLs with explicit evidence labels.
   */
  function faviconPreviewAssets() {
    const observed = [...document.querySelectorAll('link[rel~="icon"]')]
      .map(link => agentFaviconOriginalSources.get(link) || link.href)
      .filter(url => typeof url === 'string');
    return FAVICON_PREVIEW_REFERENCE.map(reference => {
      const found = observed.find(value => {
        try {
          const url = new URL(value, document.baseURI);
          return url.origin === 'https://chatgpt.com' &&
            url.pathname.startsWith('/cdn/assets/') &&
            reference.file.test(url.pathname.slice(url.pathname.lastIndexOf('/') + 1));
        } catch {
          return false;
        }
      });
      return { ...reference, url: found || reference.url,
        provenance: found ? 'Live stock DOM source' : 'Observed log reference (not currently in DOM)' };
    });
  }

  /**
   * Shows the unmodified PNG and both SVG variants within the Test matrix.
   * @param {HTMLTableRowElement} row - Visual-test row to expand or collapse.
   * @returns {void} Inserts three image previews without rewriting favicon links.
   */
  function showFaviconSourceComparison(row) {
    const sibling = row.nextElementSibling;
    if (sibling?.classList.contains('tm-favicon-source-previews')) {
      sibling.remove();
      row.querySelector('[data-role="run-test"]').textContent = 'Show';
      return;
    }
    const entry = document.createElement('tr');
    entry.className = 'tm-favicon-source-previews';
    const cell = document.createElement('td');
    cell.colSpan = 5;
    const legend = document.createElement('p');
    const browserTheme = agentFaviconCurrentTheme() || 'unknown';
    const appTheme = document.documentElement?.getAttribute('data-theme') || 'unobserved';
    legend.textContent = 'Original, unmodified favicon files. Browser theme: ' +
      browserTheme + '; ChatGPT app theme: ' + appTheme +
      '. DC overlays every eligible stock link; it does not choose the Chrome tab favicon.';
    const gallery = document.createElement('div');
    gallery.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px';
    for (const asset of faviconPreviewAssets()) {
      const card = document.createElement('section');
      card.style.cssText = 'min-width:0;border:1px solid #777;border-radius:8px;padding:8px';
      const title = document.createElement('strong');
      title.textContent = asset.label;
      const frame = document.createElement('div');
      frame.style.cssText =
        'width:88px;height:88px;box-sizing:border-box;display:flex;' +
        'align-items:center;justify-content:center;border:1px solid #777;' +
        'border-radius:6px;margin:8px 0;background:transparent';
      const image = document.createElement('img');
      image.width = 72;
      image.height = 72;
      image.alt = asset.label + ' stock favicon';
      image.style.cssText = 'width:72px;height:72px;object-fit:contain';
      const status = document.createElement('p');
      status.setAttribute('aria-live', 'polite');
      status.textContent = 'Loading…';
      image.onload = () => {
        status.textContent = 'Loaded: ' + image.naturalWidth + '×' + image.naturalHeight;
      };
      image.onerror = () => { status.textContent = 'Failed to load source'; };
      image.src = asset.url;
      const origin = document.createElement('p');
      origin.textContent = asset.provenance;
      const link = document.createElement('a');
      link.href = asset.url;
      link.textContent = asset.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.cssText = 'overflow-wrap:anywhere;font-size:11px';
      frame.append(image);
      card.append(title, frame, status, origin, link);
      gallery.append(card);
    }
    cell.append(legend, gallery);
    entry.append(cell);
    row.after(entry);
    row.querySelector('[data-role="run-test"]').textContent = 'Hide';
  }
