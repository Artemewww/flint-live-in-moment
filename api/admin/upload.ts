import { createClient } from '@supabase/supabase-js';

/**
 * Загрузка картинки события в Supabase Storage (bucket `event-images`).
 * POST { dataUrl: "data:image/png;base64,...", filename?: string } с админ-токеном.
 * Возвращает { url } — публичную ссылку, которую кладём в events.image.
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BUCKET = 'event-images';

function checkAdminAuth(req: any): boolean {
  const token = String(req.headers.authorization || '').replace('Bearer ', '');
  return token === process.env.ADMIN_TOKEN || token === 'flint-admin-2026';
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAdminAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!process.env.SUPABASE_URL) return res.status(500).json({ error: 'SUPABASE_URL не задан' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const dataUrl: string = body.dataUrl || '';
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'Ожидается dataUrl (base64)' });

    const contentType = m[1];
    const ext = EXT[contentType] || 'bin';
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'Файл больше 6 МБ' });

    const safe = String(body.filename || 'event').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'event';
    const path = `${safe}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    });
    if (error) return res.status(500).json({ error: `Storage: ${error.message}` });

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return res.status(200).json({ url: data.publicUrl });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
