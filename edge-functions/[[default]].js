/**
 * FDE Backend - EdgeOne Edge Function (Auth-only test version)
 * Only login/register/health. Build up from working minimal version.
 */
export default async function onRequest(context) {
  var env = context.env || {};
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

  var url;
  try { url = new URL(urlStr.startsWith('http') ? urlStr : 'http://localhost' + urlStr); }
  catch (e) { url = new URL('http://localhost/' + urlStr); }
  var path = url.pathname;

  // ====== Helpers (inline for simplicity) ======

  function json(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    });
  }

  async function parseBody() {
    try { var ct = request.headers.get('content-type') || ''; if (ct.indexOf('application/json') !== -1) return await request.json(); }
    catch (e) {}
    return {};
  }

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return 'h:' + (h >>> 0).toString(36);
  }

  function now() { return new Date().toISOString(); }

  function tokenPayload(data) {
    var parts = [];
    Object.keys(data).forEach(function(k) { parts.push(k + '=' + encodeURIComponent(data[k])); });
    return parts.join('&');
  }

  function signToken(user) {
    var ts = Math.floor(Date.now() / 1000);
    var payload = tokenPayload({ i: String(user.id), u: user.username, r: user.role, t: String(ts) });
    var sig = hash(payload + '-JWT');
    return 'v1.' + btoa(payload) + '.' + sig;
  }

  function verifyToken(token) {
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    var payload;
    try { payload = atob(parts[1]); } catch(e) { return null; }
    var map = {};
    payload.split('&').forEach(function(p) {
      var kv = p.split('=');
      if (kv.length === 2) map[kv[0]] = decodeURIComponent(kv[1]);
    });
    var ts = parseInt(map.t);
    if (!ts || ts + 604800 < Math.floor(Date.now() / 1000)) return null;
    if (parts[2] !== hash(payload + '-JWT')) return null;
    return { id: parseInt(map.i), username: map.u, role: map.r };
  }

  function getAuth() {
    var header = '';
    try { header = request.headers.get('authorization') || ''; } catch(e) {}
    if (!header.startsWith('Bearer ')) return null;
    return verifyToken(header.substring(7));
  }

  // ====== Supabase (simple fetch wrapper) ======

  var SB_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  var SB_KEY = env.SUPABASE_ANON_KEY || '';

  async function supabaseREST(table, method, body, queryParts) {
    if (!SB_URL || !SB_KEY) return { error: 'Supabase not configured' };
    var url = SB_URL + '/rest/v1/' + table + '?' + queryParts.join('&');
    var headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['Prefer'] = 'return=representation';
    var opts = { method: method, headers: headers };
    if (body) opts.body = JSON.stringify(body);
    var resp = await fetch(url, opts);
    var text = await resp.text();
    if (resp.status >= 400) {
      var err = text;
      try { err = JSON.parse(text); } catch(e) {}
      return { error: err, status: resp.status };
    }
    try { return { data: JSON.parse(text) }; }
    catch(e) { return { data: text }; }
  }

  // ====== API handlers ======

  // /api/health
  if (path === '/api/health' && method === 'GET') {
    return json({
      status: 'ok', timestamp: now(),
      supabase_url: SB_URL ? 'configured' : 'missing',
      supabase_key: SB_KEY ? 'configured' : 'missing'
    });
  }

  // /api/test-env
  if (path === '/api/test-env' && method === 'GET') {
    return json({ envKeys: Object.keys(env), sbUrlLen: SB_URL.length, sbKeyLen: SB_KEY.length });
  }

  // /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    var body = await parseBody();
    if (!body.username || !body.password) return json({ error: '用户名和密码不能为空' }, 400);

    var h = hash(body.password);
    var qs = ['select=*', 'username=eq.' + encodeURIComponent(body.username)];
    var r = await supabaseREST('users', 'GET', null, qs.concat('limit=1'));
    if (r.error) return json({ error: '查询用户失败', detail: r.error }, 500);

    var users = Array.isArray(r.data) ? r.data : [r.data];
    if (users.length === 0 || users[0].password_hash !== h) {
      return json({ error: '用户名或密码错误' }, 401);
    }

    var user = users[0];
    delete user.password_hash;
    return json({ token: signToken(user), user: user });
  }

  // /api/auth/register
  if (path === '/api/auth/register' && method === 'POST') {
    var body = await parseBody();
    if (!body.username || !body.password) return json({ error: '用户名和密码不能为空' }, 400);
    if (body.username.length < 2) return json({ error: '用户名至少2个字符' }, 400);
    if (body.password.length < 6) return json({ error: '密码至少6个字符' }, 400);

    // Check if user exists
    var check = await supabaseREST('users', 'GET', null, ['select=id', 'username=eq.' + encodeURIComponent(body.username), 'limit=1']);
    if (!check.error && check.data && check.data.length > 0) return json({ error: '用户名已存在' }, 409);

    // Create user
    var cr = await supabaseREST('users', 'POST', {
      username: body.username,
      password_hash: hash(body.password),
      email: body.email || '',
      role: 'user',
      created_at: now()
    }, ['select=*']);

    if (cr.error) return json({ error: '注册失败', detail: cr.error }, 500);

    var user = Array.isArray(cr.data) ? cr.data[0] : cr.data;
    if (!user || !user.id) return json({ error: '注册失败，未获取到用户信息' }, 500);

    // Create empty profile
    await supabaseREST('fde_profiles', 'POST', {
      user_id: user.id,
      name: body.username,
      email: body.email || '',
      created_at: now(),
      updated_at: now()
    });

    delete user.password_hash;
    return json({ token: signToken(user), user: user });
  }

  // /api/auth/me
  if (path === '/api/auth/me' && method === 'GET') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);

    var r = await supabaseREST('users', 'GET', null, ['select=id,username,email,role,created_at', 'id=eq.' + auth.id]);
    if (r.error) return json({ error: '查询失败' }, 500);
    var users = Array.isArray(r.data) ? r.data : [r.data];
    if (users.length === 0) return json({ error: '用户不存在' }, 404);
    return json(users[0]);
  }

  // SPA fallback
  if (!path.startsWith('/api/')) {
    return new Response('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>FDE</title></head><body><div id="root"></div></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return json({ error: 'Not Found', path: path }, 404);
}
