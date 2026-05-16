class GeminiProvider {
  get name()  { return 'gemini'; }
  get label() { return 'Gemini 2.0 Flash Lite (Google)'; }

  isAvailable() {
    return !!process.env.GEMINI_API_KEY;
  }

  async review({ systemPrompt, userMsg }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set in .env');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          role: 'user',
          parts: [{ text: userMsg }]
        }],
        generationConfig: {
          maxOutputTokens: 2000,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      if (res.status === 400 && data.error?.status === 'INVALID_ARGUMENT') throw new Error(`Invalid Gemini API key. ${msg}`);
      if (res.status === 401 || res.status === 403) throw new Error(`Invalid Gemini API key. ${msg}`);
      if (res.status === 429) throw new Error(`Gemini quota exceeded or rate limit reached. ${msg}`);
      throw new Error(`Gemini error: ${msg}`);
    }
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  }
}

module.exports = GeminiProvider;
