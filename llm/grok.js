class GrokProvider {
  get name()  { return 'grok'; }
  get label() { return 'Grok 3 Mini (xAI)'; }

  isAvailable() {
    return !!process.env.XAI_API_KEY;
  }

  async review({ systemPrompt, userMsg }) {
    const key = process.env.XAI_API_KEY;
    if (!key) throw new Error('XAI_API_KEY is not set in .env');

    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'grok-3-mini',
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMsg }
        ]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = typeof data.error === 'string' ? data.error : (data.error?.message || `HTTP ${res.status}`);
      if (res.status === 401 || res.status === 403) throw new Error(`Invalid xAI API key. ${msg}`);
      if (res.status === 429) throw new Error(`xAI quota exceeded or rate limit reached. ${msg}`);
      throw new Error(`xAI error: ${msg}`);
    }
    const raw = data.choices?.[0]?.message?.content || '';
    return JSON.parse(raw);
  }
}

module.exports = GrokProvider;
