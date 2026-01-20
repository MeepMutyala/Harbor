/**
 * Generic worker loader script.
 * This is compiled to a static file that can be loaded as a worker,
 * then receives the actual code to execute via postMessage.
 */

// This runs inside the worker
declare const self: DedicatedWorkerGlobalScope;

// Wait for code injection
self.addEventListener('message', function initHandler(event) {
  if (event.data?.type === 'load-code') {
    self.removeEventListener('message', initHandler);
    
    const code = event.data.code;
    
    try {
      // Execute the sandboxed code
      // Using Function constructor instead of eval for slightly better scoping
      const fn = new Function(code);
      fn();
    } catch (e) {
      self.postMessage({ 
        type: 'error', 
        message: e instanceof Error ? e.message : String(e) 
      });
    }
  }
});

// Signal that loader is ready for code
self.postMessage({ type: 'loader-ready' });
