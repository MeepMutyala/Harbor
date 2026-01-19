/**
 * Browser API
 *
 * Implements browser-related APIs like activeTab.readability().
 */

import type { ActiveTabReadability } from './types';

const MAX_TEXT_LENGTH = 50000;

const PRIVILEGED_PROTOCOLS = [
  'about:',
  'chrome:',
  'chrome-extension:',
  'moz-extension:',
  'edge:',
  'brave:',
  'opera:',
  'file:',
];

/**
 * Extract readable text content from the active tab.
 */
export async function getActiveTabReadability(): Promise<ActiveTabReadability> {
  // Get the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id || !tab.url) {
    throw Object.assign(
      new Error('No active tab found'),
      { code: 'ERR_INTERNAL' }
    );
  }

  // Check for privileged pages
  const url = new URL(tab.url);
  for (const protocol of PRIVILEGED_PROTOCOLS) {
    if (tab.url.startsWith(protocol)) {
      throw Object.assign(
        new Error(`Cannot read content from privileged page: ${protocol}`),
        { code: 'ERR_PERMISSION_DENIED' }
      );
    }
  }

  // Execute content extraction script
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractReadableContent,
    });

    if (!results || results.length === 0 || !results[0].result) {
      throw new Error('Failed to extract content');
    }

    const { text, title } = results[0].result as { text: string; title: string };

    return {
      url: tab.url,
      title: title || tab.title || 'Untitled',
      text: text.slice(0, MAX_TEXT_LENGTH),
    };
  } catch (error) {
    // Handle common errors
    if (error instanceof Error) {
      if (error.message.includes('Cannot access')) {
        throw Object.assign(
          new Error('Cannot read content from this page'),
          { code: 'ERR_PERMISSION_DENIED' }
        );
      }
      if (error.message.includes('No frame with id')) {
        throw Object.assign(
          new Error('Page is not accessible'),
          { code: 'ERR_INTERNAL' }
        );
      }
    }

    throw Object.assign(
      new Error(`Content extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`),
      { code: 'ERR_INTERNAL' }
    );
  }
}

/**
 * Content extraction function that runs in the page context.
 * This function is injected into the target page.
 */
function extractReadableContent(): { text: string; title: string } {
  const title = document.title;

  // Remove unwanted elements
  const elementsToRemove = [
    'script',
    'style',
    'noscript',
    'iframe',
    'object',
    'embed',
    'nav',
    'header',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[aria-hidden="true"]',
    '.ad',
    '.ads',
    '.advertisement',
    '.social-share',
    '.comments',
    '.related-posts',
    '.sidebar',
    '.cookie-banner',
    '.popup',
    '.modal',
  ];

  // Clone the document to avoid modifying the actual page
  const clone = document.body.cloneNode(true) as HTMLElement;

  // Remove unwanted elements from clone
  for (const selector of elementsToRemove) {
    const elements = clone.querySelectorAll(selector);
    elements.forEach((el) => el.remove());
  }

  // Try to find main content area
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '#content',
    '#main',
  ];

  let contentElement: HTMLElement | null = null;
  for (const selector of mainSelectors) {
    contentElement = clone.querySelector(selector);
    if (contentElement) break;
  }

  // Fall back to body if no main content found
  const targetElement = contentElement || clone;

  // Extract text
  let text = extractTextFromElement(targetElement);

  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  return { text, title };
}

/**
 * Extract text content from an element, preserving structure.
 */
function extractTextFromElement(element: HTMLElement): string {
  const textParts: string[] = [];

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        textParts.push(text);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();

      // Skip hidden elements
      const style = window.getComputedStyle?.(el);
      if (style?.display === 'none' || style?.visibility === 'hidden') {
        return;
      }

      // Add newlines for block elements
      const blockElements = [
        'p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'li', 'br', 'hr', 'blockquote', 'pre', 'table', 'tr',
      ];

      if (blockElements.includes(tagName)) {
        textParts.push('\n');
      }

      // Process children
      for (const child of el.childNodes) {
        walk(child);
      }

      if (blockElements.includes(tagName)) {
        textParts.push('\n');
      }
    }
  }

  walk(element);
  return textParts.join(' ');
}
