// web_search tool - search the web for API documentation
// Uses DuckDuckGo HTML search (no API key needed)

import { tool } from 'ai';
import { z } from 'zod';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'clx-spec-builder/1.0',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const html = await response.text();

  // Simple regex parsing of DuckDuckGo HTML results
  const results: SearchResult[] = [];
  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;

  let match;
  const urls: string[] = [];
  const titles: string[] = [];
  const snippets: string[] = [];

  while ((match = resultRegex.exec(html)) !== null) {
    // DuckDuckGo wraps URLs in a redirect, extract the actual URL
    const href = match[1];
    const urlMatch = href.match(/uddg=([^&]+)/);
    const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : href;
    urls.push(actualUrl);
    titles.push(match[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }

  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }

  for (let i = 0; i < Math.min(urls.length, 10); i++) {
    results.push({
      title: titles[i] || '',
      url: urls[i],
      snippet: snippets[i] || '',
    });
  }

  return results;
}

export const webSearchTool = tool({
  description: 'Search the web for API documentation. Returns a list of relevant URLs and snippets.',
  parameters: z.object({
    query: z.string().describe('Search query (e.g., "BetterStack API documentation monitors")'),
  }),
  execute: async ({ query }) => {
    try {
      console.log(`[Searching: ${query}]`);

      const results = await searchDuckDuckGo(query);

      if (results.length === 0) {
        return {
          success: true,
          query,
          results: [],
          message: 'No results found',
        };
      }

      return {
        success: true,
        query,
        results,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
