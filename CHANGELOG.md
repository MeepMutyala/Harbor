# Changelog

All notable changes to Harbor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-04

### Added

- Initial open source release
- **Harbor Extension**: Core infrastructure for browser-based AI
  - LLM provider connections (Ollama, OpenAI, Anthropic)
  - MCP server hosting (JavaScript and WASM)
  - Native messaging bridge (Rust)
  - Chat sidebar UI
  - OAuth flow support
- **Web Agents API Extension**: Page-facing AI capabilities
  - `window.ai` API for text generation
  - `window.agent` API for tools, browser control, and autonomous agents
  - Permission system with user consent prompts
  - Feature flags for advanced capabilities
- **Native Bridge** (Rust): Connects browser to local LLMs and services
- **MCP Server Support**: Host Model Context Protocol servers in the browser
  - JavaScript runtime for MCP servers
  - WASM runtime for compiled MCP servers
  - Built-in echo and time servers
  - Gmail example with OAuth
- **Browser Support**: Firefox (primary), Chrome, Safari (experimental)
- **Documentation**: Comprehensive guides for users and developers
- **Demo Pages**: Interactive examples showcasing the APIs

### Known Limitations

- Streaming abort not fully implemented
- Address bar LLM parsing is placeholder
- Permission granularity is basic (origin-level)
- Safari support is experimental
- Function calling uses response parsing (proper tool calling planned)

[0.1.0]: https://github.com/r/harbor/releases/tag/v0.1.0
