// api/chat.js
// Vercel Serverless Function — streaming chat SSE
// API key diterima dari header request (bukan dari env server)

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-provider');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const {
      messages,
      model = 'gpt-4o-mini',
      temperature = 0.7,
      systemPrompt = '',
      thinkingMode = false,
      searchMode = false,
    } = req.body;

    // API key dari header (dikirim browser)
    const apiKey = req.headers['x-api-key'];
    const provider = req.headers['x-provider'] || 'openai';

    if (!apiKey) {
      res.status(400).json({ error: 'API key tidak ditemukan. Masukkan di Pengaturan.' });
      return;
    }

    // Tentukan base URL provider
    const isGroq = provider === 'groq';
    const baseUrl = isGroq
      ? 'https://api.groq.com/openai/v1'
      : 'https://api.openai.com/v1';

    // Bangun system prompt
    let finalSystem = systemPrompt || 'Kamu adalah asisten AI yang helpful dan ramah. Jawab dalam bahasa yang sama dengan pertanyaan pengguna.';
    if (thinkingMode) {
      finalSystem += '\n\nSebelum menjawab, tunjukkan proses berpikirmu di dalam tag <thinking>...</thinking>, lalu berikan jawaban final setelah tag ditutup.';
    }

    // Bangun messages untuk AI
    const aiMessages = [{ role: 'system', content: finalSystem }];
    for (const m of messages) {
      if (m.image_url) {
        aiMessages.push({
          role: m.role,
          content: [
            { type: 'text', text: m.content || '' },
            { type: 'image_url', image_url: { url: m.image_url } },
          ],
        });
      } else {
        aiMessages.push({ role: m.role, content: m.content || '' });
      }
    }

    // Panggil provider dengan streaming
    const aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: aiMessages,
        stream: true,
        temperature,
        max_tokens: 4096,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      res.status(aiRes.status).json({
        error: `Provider error (${aiRes.status}): ${errText.slice(0, 300)}`,
      });
      return;
    }

    // Set header SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Baca stream dari provider dan teruskan ke client
    const reader = aiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;

          // Kirim delta ke client
          res.write(`data: ${JSON.stringify({ type: 'text', content: delta })}\n\n`);
        } catch {
          // skip malformed
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('Chat error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.end();
    }
  }
                         }
