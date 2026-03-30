/**
 * S.O.S. — Netlify Serverless Function: Claude AI Proxy
 *
 * Routes: POST /.netlify/functions/claude  (also aliased to /api/claude via netlify.toml)
 * Forwards the request body to Anthropic and injects the API key from env var.
 * The key is NEVER exposed to the browser.
 *
 * Set ANTHROPIC_API_KEY in Netlify → Site Settings → Environment Variables.
 */
exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server.' }),
    };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: event.body,
    });

    const text = await response.text();
    return {
      statusCode: response.status,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream AI request failed', detail: err.message }),
    };
  }
};
