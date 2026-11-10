'use strict';

// Web search tool.
// DuckDuckGo Lite (no API key required) as the default backend.
// Brave Search and Tavily are supported when an API key is provided in config.

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

// Tavily: POST https://api.tavily.com/search with the key as a Bearer token.
// Errors come back as {"detail":{"error":"..."}} or a FastAPI validation array.
function describeTavilyError(text) {
  try {
    const body = JSON.parse(text);
    const detail = body && body.detail;
    if (detail && typeof detail.error === 'string') return detail.error;
    if (Array.isArray(detail)) {
      const msgs = detail.map(e => e && e.msg).filter(Boolean);
      if (msgs.length) return msgs.join('; ');
    }
  } catch (e) { /* not JSON, fall through */ }
  return text.slice(0, 200);
}

function tavilySearch(query, key) {
  return fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({ query, max_results: 5 }),
  })
    .then(res =>
      res.text().then(text => {
        if (!res.ok) {
          throw new Error(
            'Tavily search failed (' + res.status + '): ' + describeTavilyError(text),
          );
        }
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error('Tavily search returned invalid JSON');
        }
      }),
    )
    .then(data => {
      const results = [];
      for (const item of (data.results || [])) {
        results.push({
          title: item.title || '',
          url: item.url || '',
          snippet: item.content || '',
        });
      }
      return results;
    });
}

// Each backend the user can order. ddg needs no key; the API ones are
// skipped when their key is missing.
const PROVIDERS = {
  tavily: { label: 'Tavily', needsKey: true, run: (query, key) => tavilySearch(query, key) },
  brave: { label: 'Brave', needsKey: true, run: (query, key) => braveSearch(query, key) },
  ddg: { label: 'DuckDuckGo', needsKey: false, run: query => ddgLite(query) },
};

// Used when the config holds no usable priority list.
const DEFAULT_PRIORITY = ['tavily', 'brave', 'ddg'];

function normalizePriority(list) {
  const seen = new Set();
  const out = [];
  for (const name of (Array.isArray(list) ? list : [])) {
    if (PROVIDERS[name] && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out.length ? out : [...DEFAULT_PRIORITY];
}

/**
 * Run a web search.
 *
 * engine 'auto' (default) walks the configured priority list in order and
 * falls back to the next provider whenever one fails or returns nothing.
 * A specific engine forces exactly that provider and errors clearly when
 * its key is missing, instead of silently using another one.
 */
async function search(query, { engine = 'auto', braveKey, tavilyKey, priority } = {}) {
  const keys = { braveKey, tavilyKey };
  let candidates;

  if (engine && engine !== 'auto') {
    const def = PROVIDERS[engine];
    if (!def) throw new Error('Unknown search engine: ' + engine);
    if (def.needsKey && !keys[engine + 'Key']) {
      throw new Error(
        def.label + ' API key not configured. Add it on the Tools page, or use engine "auto".',
      );
    }
    candidates = [engine];
  } else {
    candidates = normalizePriority(priority);
  }

  // Reasons a higher-priority provider was passed over, reported to the
  // caller so a broken key never fails silently.
  const notes = [];
  let emptyResult = null;

  for (const name of candidates) {
    const def = PROVIDERS[name];
    if (def.needsKey && !keys[name + 'Key']) continue;
    let results;
    try {
      results = await def.run(query, keys[name + 'Key']);
    } catch (err) {
      notes.push(name + ': ' + err.message);
      continue;
    }
    if (results.length) {
      const out = { engine: name, query, results };
      if (notes.length) out.warnings = notes;
      return out;
    }
    notes.push(name + ': no results');
    if (!emptyResult) emptyResult = { engine: name, query, results: [] };
  }

  if (emptyResult) {
    emptyResult.warnings = notes;
    return emptyResult;
  }
  throw new Error(
    notes.length
      ? 'All search providers failed — ' + notes.join(' | ')
      : 'No search provider is available. Configure an API key, or add DuckDuckGo to the priority on the Tools page.',
  );
}

module.exports = { search };
