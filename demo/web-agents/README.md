# Web Agents Demos (Extension 1)

Basic Web Agent API demos for LLM and MCP server access.

## Demos

### Getting Started
Interactive walkthrough of the Web Agent API basics.

### Chat Demo
Full-featured chat interface using `window.agent.run()`.

### Page Summarizer
Simple page summarization using `window.ai.createTextSession()`.

### Chrome Compat Demo
Demonstrates Chrome Prompt API compatibility.

### Email Chat
Chat with your Gmail inbox using MCP tools.

### Page Chat Bookmarklet
Drag-and-drop bookmarklet for chatting about any page.

### Bring Your Own Chatbot
Demo of BYOC integration using `<link rel="mcp-server">`.

## APIs Covered

- `window.ai.createTextSession()` - LLM sessions
- `window.agent.requestPermissions()` - Permission management
- `window.agent.tools.list()` - List MCP tools
- `window.agent.tools.call()` - Call MCP tools
- `window.agent.run()` - Autonomous agent tasks
- `window.agent.browser.activeTab.readability()` - Read page content
- `window.agent.capabilities()` - Query available capabilities
