'use strict';

// Web search tool.
// DuckDuckGo Lite (no API key required) as the default backend.
// Brave Search is supported when an API key is provided in config.

const fetch = globalThis.fetch;

const DDG_LITE = 'https://html.duckduckgo.com/html/';

function ddgLite(query) {
  const url = DDG_LITE + '?q=' + encodeURIComponent(query);
  return fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) LibreHarnes/1.0',
      'Accept': 'text/html',
    },
  })
    .then(res => res.text())
    .then(html => parseDuckDuckGoLite(html));
}

function parseDuckDuckGoLite(html) {
  const results = [];
  // Very light, dependency-free parsing of DDG lite result links/titles/snippets.
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

  let m;
  const links = [];
  while ((m = linkRe.exec(html)) !== null) {
    let href = m[1] || '';
    // DDG wraps links in a redirect: //duckduckgo.com/l/?uddg=<urlencoded>
    const uddg = href.match(/uddg=([^&]+)/);
    if (uddg) {
      try { href = decodeURIComponent(uddg[1]); } catch (e) { /* keep raw */ }
    }
    links.push({ href, title: stripTags(m[2]) });
  }
  let i = 0;
  while ((m = snippetRe.exec(html)) !== null) {
    if (links[i]) links[i].snippet = stripTags(m[1]);
    i++;
  }

  for (const l of links.slice(0, 5)) {
    results.push({
      title: l.title || '(no title)',
      url: l.href || '',
      snippet: l.snippet || '',
    });
  }
  return results;
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function braveSearch(query, key) {
  const url = 'https://api.search.brave.com/res/v1/web/search?q=' +
    encodeURIComponent(query);
  return fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': key,
    },
  })
    .then(res => {
      if (!res.ok) throw new Error('Brave search failed: ' + res.status);
      return res.json();
    })
    .then(data => {
      const results = [];
      for (const item of (data.web || {}).results || []) {
        results.push({
          title: item.title || '',
          url: item.url || '',
          snippet: item.description || '',
        });
      }
      return results.slice(0, 5);
    });
}

function search(query, { engine = 'ddg', braveKey } = {}) {
  if (engine === 'brave' && braveKey) {
    return braveSearch(query, braveKey).then(list => ({ engine: 'brave', query, results: list }));
  }
  return ddgLite(query).then(list => ({ engine: 'ddg', query, results: list }));
}

module.exports = { search };
