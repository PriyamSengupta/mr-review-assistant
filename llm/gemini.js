class GeminiProvider {
  get name()  { return 'gemini'; }
  get label() { return 'Gemini 2.0 Flash (Google)'; }

  isAvailable() {
    return !!process.env.GEMINI_API_KEY;
  }

  async review({ systemPrompt, userMsg }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set in .env');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;

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
    if (data.error) throw new Error(data.error.message);
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  }
}

module.exports = GeminiProvider;
