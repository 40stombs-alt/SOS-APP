/**
 * Vercel Serverless Function — Green API WhatsApp Webhook
 * Receives incoming WhatsApp messages and posts them to the S.O.S. notice board.
 *
 * Setup:
 *  1. Set SUPABASE_URL, SUPABASE_ANON_KEY, WHATSAPP_SECRET in Vercel env vars
 *  2. In Green API dashboard → Notifications → set webhook URL to:
 *     https://your-vercel-app.vercel.app/api/whatsapp
 *  3. Enable "Receive webhooks" and "incomingMessageReceived" event type
 *
 * Message format (admins send these in WhatsApp):
 *   [NEWS] Your message here
 *   [URGENT] Your message here
 *   [CRITICAL] Your message here
 *   (no tag = defaults to "news")
 *
 * Optional — restrict to admin numbers only:
 *   Set WHATSAPP_ADMIN_NUMBERS=27821234567,27831234567 in env vars
 */

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const WHATSAPP_SECRET   = process.env.WHATSAPP_SECRET || '';       // optional shared secret
const ADMIN_NUMBERS     = process.env.WHATSAPP_ADMIN_NUMBERS || ''; // comma-separated, no +

module.exports = async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional secret validation (set in Green API webhook header or query param)
  const incomingSecret = req.query.secret || req.headers['x-webhook-secret'] || '';
  if (WHATSAPP_SECRET && incomingSecret !== WHATSAPP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;

    // Green API only sends this type for new messages
    if (body?.typeWebhook !== 'incomingMessageReceived') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    // Only handle plain text messages
    if (body?.messageData?.typeMessage !== 'textMessage') {
      return res.status(200).json({ ok: true, skipped: 'non-text message' });
    }

    const rawText    = body.messageData.textMessageData?.textMessage || '';
    const senderName = body.senderData?.senderName || 'WhatsApp Admin';
    const senderNum  = body.senderData?.sender?.replace('@c.us', '') || '';

    // If admin filter is set, only process messages from those numbers
    if (ADMIN_NUMBERS) {
      const allowed = ADMIN_NUMBERS.split(',').map(n => n.trim());
      if (!allowed.includes(senderNum)) {
        return res.status(200).json({ ok: true, skipped: 'not an admin number' });
      }
    }

    // Parse criticality tag from message
    // Supports: [NEWS], [URGENT], [CRITICAL] — case insensitive
    const tagMatch   = rawText.match(/^\[?(NEWS|URGENT|CRITICAL)\]?\s*/i);
    const criticality = tagMatch ? tagMatch[1].toLowerCase() : 'news';
    const message     = rawText.replace(/^\[?(NEWS|URGENT|CRITICAL)\]?\s*/i, '').trim();

    if (!message) {
      return res.status(200).json({ ok: true, skipped: 'empty message' });
    }

    // Insert into Supabase announcements table
    const response = await fetch(`${SUPABASE_URL}/rest/v1/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        sender_id:    senderNum || 'whatsapp',
        sender_name:  senderName,
        sender_title: 'WhatsApp',
        message,
        criticality,
        expires_at:   null,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[SOS WhatsApp] Supabase insert failed:', err);
      return res.status(500).json({ error: 'Failed to save announcement' });
    }

    return res.status(200).json({ ok: true, criticality, message });

  } catch (err) {
    console.error('[SOS WhatsApp] Unexpected error:', err);
    return res.status(500).json({ error: err.message });
  }
}
