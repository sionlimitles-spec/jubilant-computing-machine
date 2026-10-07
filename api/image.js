// api/image.js
export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { prompt, size = '1024x1024' } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      res.status(400).json({ error: 'API key belum diisi' });
      return;
    }
    if (!prompt) {
      res.status(400).json({ error: 'Prompt diperlukan' });
      return;
    }

    const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size,
        quality: 'auto',
      }),
    });

    if (!imgRes.ok) {
      const err = await imgRes.text();
      res.status(imgRes.status).json({ error: `Image API error: ${err.slice(0, 300)}` });
      return;
    }

    const data = await imgRes.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      res.status(500).json({ error: 'Gagal generate gambar' });
      return;
    }

    // Upload ke Supabase Storage (via anon key dari env server)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    let imageUrl = null;

    if (supabaseUrl && supabaseKey) {
      const binaryStr = Buffer.from(b64, 'base64');
      const filename = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;

      const uploadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/ai-generated/${filename}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'image/png',
          },
          body: binaryStr,
        }
      );

      if (uploadRes.ok) {
        imageUrl = `${supabaseUrl}/storage/v1/object/public/ai-generated/${filename}`;
      }
    }

    // Fallback: return base64 langsung
    if (!imageUrl) {
      imageUrl = `data:image/png;base64,${b64}`;
    }

    res.status(200).json({ url: imageUrl, prompt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
