class OpenAIProvider {
  get name()  { return 'openai'; }
  get label() { return 'GPT-4o (OpenAI)'; }

  isAvailable() {
    return !!process.env.OPENAI_API_KEY;
  }

  async review({ systemPrompt, userMsg }) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set in .env');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMsg }
        ]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.choices?.[0]?.message?.content || '';
    return JSON.parse(raw);
  }
}

module.exports = OpenAIProvider;
