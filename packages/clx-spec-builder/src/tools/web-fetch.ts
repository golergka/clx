// web_fetch tool - fetch and parse web documentation

import { tool } from 'ai';
import { z } from 'zod';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Remove script and style elements
turndown.remove(['script', 'style', 'nav', 'footer', 'header']);

export const webFetchTool = tool({
  description: 'Fetch a web page and convert it to markdown. Use this to read API documentation.',
  parameters: z.object({
    url: z.string().url().describe('The URL to fetch'),
  }),
  execute: async ({ url }) => {
    try {
      console.log(`[Fetching: ${url}]`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'clx-spec-builder/1.0 (API documentation parser)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') || '';
      const html = await response.text();

      // If it's not HTML, return raw content
      if (!contentType.includes('text/html')) {
        return {
          success: true,
          url,
          contentType,
          content: html.slice(0, 50000), // Limit size
        };
      }

      // Convert HTML to markdown
      const markdown = turndown.turndown(html);

      // Truncate if too long
      const truncated = markdown.length > 50000
        ? markdown.slice(0, 50000) + '\n\n[Content truncated...]'
        : markdown;

      return {
        success: true,
        url,
        contentType: 'text/markdown',
        content: truncated,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
