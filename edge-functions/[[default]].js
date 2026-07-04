/**
 * Minimal diagnostic edge function for EdgeOne Pages
 * No dependencies, no env vars needed
 */

export default async function onRequest(context) {
  var request = context.request;
  var urlStr = request.url;
  var method = request.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  // Parse URL
  var url;
  try {
    url = new URL(urlStr.startsWith('http') ? urlStr : 'http://localhost' + urlStr);
  } catch (e) {
    url = new URL('http://localhost' + (urlStr.startsWith('/') ? urlStr : '/' + urlStr));
  }
  var path = url.pathname;

  // Health endpoint — no DB needed
  if (path === '/api/health' && method === 'GET') {
    return new Response(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Edge function is working!',
      envKeys: Object.keys(context.env || {}),
      hasContext: !!context,
      hasRequest: !!request
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // Test env endpoint
  if (path === '/api/test-env' && method === 'GET') {
    var info = {
      contextType: typeof context,
      contextKeys: Object.keys(context || {}),
      envType: typeof (context && context.env),
      envValue: context ? JSON.stringify(context.env || {}) : 'no context',
      processEnvExists: typeof process !== 'undefined'
    };
    return new Response(JSON.stringify(info), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // Login endpoint (with hardcoded test)
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      var body = await request.json();
      return new Response(JSON.stringify({
        received: body,
        note: 'Login endpoint reached successfully'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }

  // SPA fallback for everything else
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FDE</title></head><body>SPA fallback</body></html>';
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
