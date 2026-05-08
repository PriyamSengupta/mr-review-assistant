class AnthropicProvider {
  get name()  { return 'anthropic'; }
  get label() { return 'Claude Sonnet 4 (Anthropic)'; }

  isAvailable() {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async review({ systemPrompt, userMsg }) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set in .env');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.content?.find(b => b.type === 'text')?.text || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  }
}

module.exports = AnthropicProvider;
