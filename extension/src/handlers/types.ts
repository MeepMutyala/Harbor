/**
 * Handler Types for Harbor Extension
 * 
 * Common types and utilities for message handlers.
 */

import { browserAPI } from '../browser-compat';

/**
 * Standard response format for handlers.
 */
export interface HandlerResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Handler function type.
 */
export type MessageHandler = (
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: HandlerResponse) => void
) => boolean | void;

/**
 * Create a handler response with error.
 */
export function errorResponse(error: unknown): HandlerResponse {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Wrap an async handler to properly handle errors.
 */
export function asyncHandler(
  handler: (
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender
  ) => Promise<HandlerResponse>
): MessageHandler {
  return (message, sender, sendResponse) => {
    handler(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(errorResponse(error)));
    return true; // Indicates async response
  };
}

/**
 * Register a handler for a specific message type.
 */
export function registerHandler(type: string, handler: MessageHandler): void {
  browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== type) {
      return false;
    }
    return handler(message, sender, sendResponse);
  });
}

/**
 * Register an async handler for a specific message type.
 */
export function registerAsyncHandler(
  type: string,
  handler: (
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender
  ) => Promise<HandlerResponse>
): void {
  registerHandler(type, asyncHandler(handler));
}
