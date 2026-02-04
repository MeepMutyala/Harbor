# Your AI

**a proposal for AI that's on your side**

---

## the contract is broken

the internet was supposed to be different.

it was a vibrant bazaar — noisy, chaotic, offbeat. every click brought you somewhere new. you could explore, question, discover things you hadn't known to look for. the tools invited you to build.

that internet is disappearing.

today's internet is a slick concierge. it speaks in soothing statements. it offers frictionless, flattering experiences. it knows what you want before you do — or thinks it does. and it's trained to keep you engaged, not to help you think.

we've traded exploration for optimization. agency for convenience. ownership for access.

and now AI is accelerating the same pattern.

---

## the problem isn't the technology

AI could be the most empowering technology we've built. it could help us think, create, understand. it could be a tool that serves us.

instead, we're watching a familiar movie play out again.

**you're a renter, not an owner.** you use whatever model a website embedded. your preferences reset on every site. your context is scattered and inaccessible. when you switch from ChatGPT to Claude, everything you've built disappears. you're renting your ability to reason — and the landlord can change the terms anytime.

**the systems aren't neutral.** they encode values and incentives. values shape the worldview baked into their responses: what's framed as helpful or harmful, legitimate or fringe. incentives shape what gets optimized: engagement, cost reduction, controversy avoidance. every answer carries both the choices of the people who built it and the pressures of the system that sustains it.

**validation is purchased, not earned.** these systems are sticky because they're designed to be. they flatter. they affirm. they pay pure attention. but when validation comes from a system we don't control, trained on choices we didn't make, optimized for metrics we didn't set — we should pause.

the problem isn't AI. the problem is the contract. and the contract is set by architecture.

---

## architecture is the lever

policy moves slowly. markets follow incentives. culture shifts over generations.

but architecture — the technical foundations of how systems work — shapes what's possible, what's easy, what's default. architecture is the fastest lever we have.

a decade ago, browsers introduced permission prompts for cameras and microphones. sensitive resources that websites could request but not access without consent. that architectural choice — mediation by the browser — changed what was possible. it didn't eliminate privacy violations, but it made them harder, more visible, more accountable.

we think the same pattern applies to AI.

---

## the proposal

we propose an architecture where the browser becomes the control point for AI.

three ideas:

### 1. LLMs, credentials, and tools terminate in the browser

today, when you use AI on a website, the website controls everything: which model, which provider, what data gets sent, what gets retained.

we propose flipping this.

the browser becomes where your AI lives. your model connections. your API keys. your tool integrations (via protocols like MCP). websites don't embed AI — they request capabilities from the AI you've already configured.

this gives you choice. you pick the model. you pick the provider. you can switch anytime. you can run locally if you want.

this gives you control. you see what's being requested. you grant or deny access. you can revoke permissions.

this gives you freedom. you're not locked in. your AI is yours.

### 2. context stays in the browser

today, your context is scattered across platforms. your conversation history lives in ChatGPT. your preferences live in Claude. your documents live in Google. nothing connects.

we propose making context a browser resource.

your accumulated context — conversation history, preferences, identity, credentials — stays in the browser. it's yours. websites can request access to specific context with your consent. but the context doesn't leave unless you say so.

context is all you need. if the browser holds your context, you can bring it to any AI, any website, any tool. switching providers doesn't mean starting over.

### 3. an API layer for developers

if the browser mediates AI capabilities, developers need a way to access them.

we propose a standard API surface that lets websites:

- request AI capabilities (with user consent)
- discover and call tools the user has configured
- access context the user has shared
- run tasks using the user's AI

this makes AI a platform capability — as accessible to developers as `fetch()` or `localStorage`. no API key management. no inference costs. progressive enhancement.

websites expose domain expertise (tools, data, functionality). users bring their AI. the website gets powerful capabilities without building AI infrastructure. the user keeps control.

---

## what this enables

**for users:** you control which AI you use. your context travels with you. your preferences persist. you're not locked into whatever model a website chose. you're an owner, not a renter.

**for publishers:** a news site exposes tools to query its 20-year archive. readers run deep research using their own AI. the publisher pays nothing for inference.

**for e-commerce:** your AI brings your context ("I own a MacBook Pro M3, prefer brand-name electronics") and surfaces compatible accessories without you re-explaining your setup.

**for SaaS:** applications expose domain tools — document analysis, search, workflow automation — without becoming AI infrastructure companies.

**for the ecosystem:** portable context reduces switching barriers. that's bad for platforms that rely on lock-in. it's good for independents competing on utility. it's good for users who want to move freely.

---

## one sketch: Harbor and the Web Agent API

to test whether this architecture actually works, we built a sketch.

**Harbor** is a browser extension that implements this pattern. **the Web Agent API** is the interface it exposes to websites.

this isn't a product. it's a sketch — something concrete to point at. it's easier to have a conversation about "should context sharing work this way?" when you can look at code than when you're debating abstractions.

what the sketch demonstrates:

- websites can declare tools (via MCP); users can discover and connect to them
- users can bring their own AI provider to any website
- permissions can be scoped, granted, and revoked per-origin
- context can be mediated by the browser
- this is practically viable, not just theoretically sound

the bet is on the architectural pattern — browser as control point for AI — not on this particular implementation.

---

### how the sketch works

websites declare their tools:

```html
<link rel="mcp-server" 
      href="https://news.example/mcp" 
      title="Archive Search">
```

the API exposes AI capabilities to websites:

```javascript
// text generation (compatible with Chrome's Prompt API)
const session = await window.ai.createTextSession({
  systemPrompt: "you are a research assistant."
});
const response = await session.prompt("summarize this article");

// tools and autonomous execution
for await (const event of window.agent.run({
  task: 'find coverage of the 2008 financial crisis',
  maxToolCalls: 10
})) {
  if (event.type === 'tool_call') console.log('using:', event.tool);
  if (event.type === 'final') console.log('done:', event.output);
}
```

permissions follow patterns established for cameras and location:

| scope | what it allows |
|-------|----------------|
| `model:prompt` | basic text generation |
| `model:tools` | AI with tool-calling enabled |
| `mcp:tools.call` | execute specific tools |
| `browser:activeTab.read` | read current page content |

[more on how the sketch works →](../spec/explainer.md)

---

## what we don't know

this is a proposal, not a finished design. there are questions we haven't answered.

**session persistence:** should AI sessions persist across page reloads? better UX, but privacy implications.

**cross-origin context:** should users share context across sites? powerful, but risky.

**the adoption path:** why would websites expose tools? why would browsers implement this? what's the path from proposal to reality?

**whether this is the right architecture:** maybe the browser isn't the right control point. maybe the patterns are wrong. maybe we're solving the wrong problem.

we have hypotheses. we don't have answers.

---

## an invitation

we're not trying to own this.

we're trying to figure out what user-controlled AI should look like. that's a bigger question than any one organization can answer.

we want thought partners. people who will push back on the assumptions. find the holes in the architecture. propose alternatives. tell us if we're solving the wrong problem.

**if you build for the web:** what would you build with this? what's missing?

**if you think about security:** what attack vectors haven't we considered?

**if you think about privacy:** are there data flows we should restrict? tracking vectors we've introduced?

**if you think about standards:** is the browser the right layer? is this the right abstraction?

**if you think about incentives:** what's the path to adoption?

this is an open conversation. we've written down our current thinking. we'd like to know yours.

[read our values →](values.md) · [see our open questions →](feedback.md)

---

## how to engage

**try the sketch:** [install Harbor](../QUICKSTART.md), run the demos, build something, tell us what broke.

**contribute:** [GitHub Issues](https://github.com/anthropics/harbor/issues) · [Discussions](https://github.com/anthropics/harbor/discussions)

**reach out:** if you're working on related problems, we'd like to talk.

---

*this is a living document. last updated: January 2026.*

*we kept the web open once — not by asking permission, but by building something better. the question is whether we can do it again.*
