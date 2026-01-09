/**
 * Multi-Provider LLM API Tests
 * 
 * Tests for the new window.ai.providers API and provider selection in sessions.
 */

import { describe, it, expect } from 'vitest';
import type {
  PermissionScope,
  TextSessionOptions,
  AgentRunOptions,
  LLMProviderInfo,
  ActiveLLMConfig,
} from '../types';

describe('LLM Provider Types (JS_AI_PROVIDER_API.md)', () => {
  describe('model:list Permission Scope', () => {
    it('should be a valid permission scope', () => {
      const scopes: PermissionScope[] = [
        'model:prompt',
        'model:tools',
        'model:list',  // New scope
        'mcp:tools.list',
        'mcp:tools.call',
        'browser:activeTab.read',
        'web:fetch',
      ];

      expect(scopes).toContain('model:list');
    });
  });

  describe('LLMProviderInfo Interface', () => {
    it('should have correct structure for available provider', () => {
      const provider: LLMProviderInfo = {
        id: 'openai',
        name: 'OpenAI',
        available: true,
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
        isDefault: true,
        supportsTools: true,
      };

      expect(provider.id).toBe('openai');
      expect(provider.name).toBe('OpenAI');
      expect(provider.available).toBe(true);
      expect(provider.baseUrl).toBeDefined();
      expect(provider.models).toContain('gpt-4o');
      expect(provider.isDefault).toBe(true);
      expect(provider.supportsTools).toBe(true);
    });

    it('should have correct structure for unavailable provider', () => {
      const provider: LLMProviderInfo = {
        id: 'anthropic',
        name: 'Anthropic',
        available: false,
        isDefault: false,
      };

      expect(provider.id).toBe('anthropic');
      expect(provider.available).toBe(false);
      expect(provider.models).toBeUndefined();
      expect(provider.isDefault).toBe(false);
    });

    it('should support local providers', () => {
      const ollamaProvider: LLMProviderInfo = {
        id: 'ollama',
        name: 'Ollama',
        available: true,
        baseUrl: 'http://localhost:11434',
        models: ['llama3.2', 'mistral', 'codellama'],
        isDefault: false,
        supportsTools: true,
      };

      expect(ollamaProvider.id).toBe('ollama');
      expect(ollamaProvider.baseUrl).toBe('http://localhost:11434');
      expect(ollamaProvider.available).toBe(true);
    });
  });

  describe('ActiveLLMConfig Interface', () => {
    it('should have correct structure when provider is active', () => {
      const config: ActiveLLMConfig = {
        provider: 'openai',
        model: 'gpt-4o',
      };

      expect(config.provider).toBe('openai');
      expect(config.model).toBe('gpt-4o');
    });

    it('should support null values when no provider configured', () => {
      const config: ActiveLLMConfig = {
        provider: null,
        model: null,
      };

      expect(config.provider).toBeNull();
      expect(config.model).toBeNull();
    });
  });

  describe('TextSessionOptions with Provider', () => {
    it('should support provider parameter', () => {
      const options: TextSessionOptions = {
        model: 'gpt-4o',
        provider: 'openai',
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant.',
      };

      expect(options.provider).toBe('openai');
      expect(options.model).toBe('gpt-4o');
    });

    it('should work without provider (uses default)', () => {
      const options: TextSessionOptions = {
        temperature: 0.7,
      };

      expect(options.provider).toBeUndefined();
    });

    it('should support all provider types', () => {
      const providers = ['openai', 'anthropic', 'ollama', 'llamafile', 'mistral', 'groq'];

      for (const provider of providers) {
        const options: TextSessionOptions = {
          provider,
        };
        expect(options.provider).toBe(provider);
      }
    });
  });

  describe('AgentRunOptions with Provider', () => {
    it('should support provider parameter', () => {
      const options: AgentRunOptions = {
        task: 'Research AI news',
        provider: 'anthropic',
        maxToolCalls: 10,
      };

      expect(options.provider).toBe('anthropic');
      expect(options.task).toBe('Research AI news');
    });

    it('should work without provider (uses default)', () => {
      const options: AgentRunOptions = {
        task: 'Do something',
      };

      expect(options.provider).toBeUndefined();
    });
  });
});

describe('Provider API Behavior', () => {
  describe('Provider List Scenarios', () => {
    it('should handle multiple available providers', () => {
      // Scenario: User has both Ollama and OpenAI configured
      const providers: LLMProviderInfo[] = [
        {
          id: 'ollama',
          name: 'Ollama',
          available: true,
          baseUrl: 'http://localhost:11434',
          models: ['llama3.2'],
          isDefault: true,
          supportsTools: true,
        },
        {
          id: 'openai',
          name: 'OpenAI',
          available: true,
          models: ['gpt-4o'],
          isDefault: false,
          supportsTools: true,
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          available: false,
          isDefault: false,
        },
      ];

      // Filter to available providers
      const available = providers.filter(p => p.available);
      expect(available).toHaveLength(2);

      // Find default
      const defaultProvider = providers.find(p => p.isDefault);
      expect(defaultProvider?.id).toBe('ollama');

      // Find by ID
      const openai = providers.find(p => p.id === 'openai');
      expect(openai?.name).toBe('OpenAI');
    });

    it('should handle no available providers', () => {
      const providers: LLMProviderInfo[] = [
        {
          id: 'openai',
          name: 'OpenAI',
          available: false,
          isDefault: false,
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          available: false,
          isDefault: false,
        },
      ];

      const available = providers.filter(p => p.available);
      expect(available).toHaveLength(0);

      const defaultProvider = providers.find(p => p.isDefault);
      expect(defaultProvider).toBeUndefined();
    });
  });

  describe('Provider Selection Logic', () => {
    it('should use specified provider over default', () => {
      // When user specifies provider, it should be used even if not default
      const options: TextSessionOptions = {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
      };

      // The provider field takes precedence
      expect(options.provider).toBe('anthropic');
    });

    it('should fall back to default when no provider specified', () => {
      const options: TextSessionOptions = {
        temperature: 0.7,
      };

      // No provider = use active/default
      expect(options.provider).toBeUndefined();
    });
  });
});

describe('Permission Flow for model:list', () => {
  it('should require model:list permission for provider listing', () => {
    // Per API docs: ai.providers.list() requires 'model:list' permission
    const requiredScopes: PermissionScope[] = ['model:list'];
    
    expect(requiredScopes).toContain('model:list');
    expect(requiredScopes).not.toContain('model:prompt');
  });

  it('should work independently of model:prompt', () => {
    // You can list providers without being able to use them
    const listOnlyScopes: PermissionScope[] = ['model:list'];
    const promptOnlyScopes: PermissionScope[] = ['model:prompt'];

    expect(listOnlyScopes).not.toContain('model:prompt');
    expect(promptOnlyScopes).not.toContain('model:list');
  });

  it('should allow requesting both scopes together', () => {
    const scopes: PermissionScope[] = ['model:list', 'model:prompt'];

    expect(scopes).toContain('model:list');
    expect(scopes).toContain('model:prompt');
    expect(scopes).toHaveLength(2);
  });
});

describe('Usage Examples from Documentation', () => {
  it('should support the list providers example', () => {
    // From JS_AI_PROVIDER_API.md:
    // const providers = await window.ai.providers.list();
    
    const exampleProviders: LLMProviderInfo[] = [
      {
        id: 'openai',
        name: 'OpenAI',
        available: true,
        models: ['gpt-4o', 'gpt-4o-mini'],
        isDefault: true,
        supportsTools: true,
      },
      {
        id: 'ollama',
        name: 'Ollama',
        available: true,
        baseUrl: 'http://localhost:11434',
        models: ['llama3.2'],
        isDefault: false,
        supportsTools: true,
      },
    ];

    // Example code from docs:
    for (const provider of exampleProviders) {
      const status = provider.available ? '✓' : '✗';
      const defaultMark = provider.isDefault ? ' (default)' : '';
      console.log(`  ${status} ${provider.name}${defaultMark}`);
      
      if (provider.models) {
        console.log(`    Models: ${provider.models.join(', ')}`);
      }
    }

    expect(exampleProviders).toHaveLength(2);
  });

  it('should support the get active example', () => {
    // From JS_AI_PROVIDER_API.md:
    // const active = await window.ai.providers.getActive();
    
    const active: ActiveLLMConfig = {
      provider: 'openai',
      model: 'gpt-4o',
    };

    // Example code from docs:
    if (active.provider) {
      console.log(`Using ${active.provider} with model ${active.model}`);
    } else {
      console.log('No LLM provider configured');
    }

    expect(active.provider).toBe('openai');
  });

  it('should support the specific provider session example', () => {
    // From JS_AI_PROVIDER_API.md:
    // const session = await window.ai.createTextSession({
    //   provider: 'anthropic',
    //   model: 'claude-3-5-sonnet-20241022',
    //   systemPrompt: 'You are Claude...',
    // });
    
    const options: TextSessionOptions = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'You are Claude, a helpful AI assistant.',
    };

    expect(options.provider).toBe('anthropic');
    expect(options.model).toBe('claude-3-5-sonnet-20241022');
  });
});

