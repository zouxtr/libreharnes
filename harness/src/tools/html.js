'use strict';

// Read a URL and return readable text (title + main text, links stripped).
// Very light: fetch + strip tags. No heavy readability library.

const fetch = globalThis.fetch;

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]) : '(no title)';
}

async function readHtml(url, { maxChars = 6000 } = {}) {
  let text = '';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) LibreHarnes/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const title = extractTitle(html);
    text = stripTags(html);
    if (text.length > maxChars) text = text.slice(0, maxChars) + '…';
    return { url, title, text };
  } catch (err) {
    return { url, title: '(error)', text: 'Failed to read ' + url + ': ' + err.message };
  }
}

module.exports = { readHtml };
