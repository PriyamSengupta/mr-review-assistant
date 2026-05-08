const AnthropicProvider = require('./anthropic');
const OpenAIProvider    = require('./openai');
const GeminiProvider    = require('./gemini');

const registry = {
  anthropic: new AnthropicProvider(),
  openai:    new OpenAIProvider(),
  gemini:    new GeminiProvider()
};

function getProvider(name = 'anthropic') {
  const provider = registry[name];
  if (!provider) {
    throw new Error(`Unknown LLM provider "${name}". Valid options: ${Object.keys(registry).join(', ')}`);
  }
  return provider;
}

function listProviders() {
  return Object.values(registry).map(p => ({
    id:        p.name,
    label:     p.label,
    available: p.isAvailable()
  }));
}

module.exports = { getProvider, listProviders };
