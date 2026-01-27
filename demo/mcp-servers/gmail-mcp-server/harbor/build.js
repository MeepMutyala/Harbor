#!/usr/bin/env node
/**
 * Build script for Gmail Harbor MCP Server
 * 
 * Generates a distributable manifest.json with the server code embedded as base64.
 * This allows the server to be installed without needing to fetch external files.
 * 
 * Usage:
 *   node build.js              # Outputs to dist/gmail-harbor.manifest.json
 *   node build.js --stdout     # Outputs to stdout (for piping)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the source files
const serverCode = fs.readFileSync(path.join(__dirname, 'gmail-harbor.js'), 'utf8');
const manifestTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));

// Minify by removing comments and extra whitespace (simple minification)
function minify(code) {
  return code
    // Remove single-line comments (but not URLs)
    .replace(/(?<!:)\/\/.*$/gm, '')
    // Remove multi-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Collapse multiple newlines
    .replace(/\n\s*\n/g, '\n')
    // Trim lines
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');
}

// Build the distributable manifest
const distManifest = {
  ...manifestTemplate,
  // Remove scriptUrl and add scriptBase64
  scriptUrl: undefined,
  scriptBase64: Buffer.from(serverCode).toString('base64'),
};

// Clean up undefined fields
delete distManifest.scriptUrl;

// Output
const outputJson = JSON.stringify(distManifest, null, 2);

if (process.argv.includes('--stdout')) {
  console.log(outputJson);
} else {
  // Create dist directory
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  
  const outputPath = path.join(distDir, 'gmail-harbor.manifest.json');
  fs.writeFileSync(outputPath, outputJson);
  
  // Also create a minified version
  const minifiedManifest = {
    ...manifestTemplate,
    scriptUrl: undefined,
    scriptBase64: Buffer.from(minify(serverCode)).toString('base64'),
  };
  delete minifiedManifest.scriptUrl;
  
  const minifiedPath = path.join(distDir, 'gmail-harbor.min.manifest.json');
  fs.writeFileSync(minifiedPath, JSON.stringify(minifiedManifest));
  
  // Stats
  const originalSize = serverCode.length;
  const minifiedSize = minify(serverCode).length;
  const base64Size = distManifest.scriptBase64.length;
  
  console.log('Gmail Harbor MCP Server - Build Complete');
  console.log('========================================');
  console.log(`Source:     ${originalSize.toLocaleString()} bytes`);
  console.log(`Minified:   ${minifiedSize.toLocaleString()} bytes (${Math.round(minifiedSize/originalSize*100)}%)`);
  console.log(`Base64:     ${base64Size.toLocaleString()} bytes`);
  console.log('');
  console.log('Output files:');
  console.log(`  ${outputPath}`);
  console.log(`  ${minifiedPath}`);
}
