/**
 * EdgeOne Pages - Root handler
 * Serves a simple API info page for non-API routes.
 */
async function onRequest(context) {
  return new Response(JSON.stringify({
    name: 'FDE Server API',
    version: '1.0.0',
    docs: 'API endpoints available at /api/*',
    health: '/api/health',
    auth: {
      register: 'POST /api/auth/register',
      login: 'POST /api/auth/login',
      me: 'GET /api/auth/me',
      password: 'PUT /api/auth/password'
    }
  }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

module.exports = { onRequest };
