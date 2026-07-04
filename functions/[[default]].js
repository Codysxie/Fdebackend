/**
 * EdgeOne Pages Edge Function - Catch-all Handler (ZERO-DEPENDENCY VERSION)
 *
 * This is a diagnostic version to verify that the edge function is being invoked.
 * If /api/* routes still return HTML, the issue is with EdgeOne routing, not npm modules.
 */

// ===================== Helpers =====================

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

function getQueryParams(url) {
  var fullUrl = url.startsWith('http') ? url : 'http://localhost' + url;
  var parsed = new URL(fullUrl);
  var params = {};
  parsed.searchParams.forEach(function (v, k) { params[k] = v; });
  return params;
}

// ===================== SPA HTML =====================

var SPA_HTML = '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'  <head>\n' +
'    <meta charset="UTF-8" />\n' +
'    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><text y=\\'.9em\\' font-size=\\'90\\'>F</text></svg>" />\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'    <link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
'    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
'    <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@500;600;700&display=swap" rel="stylesheet" />\n' +
'    <title>FDE - 前沿部署工程师</title>\n' +
'    <script type="module" crossorigin src="/assets/index-B-KrccSR.js"></script>\n' +
'    <link rel="stylesheet" crossorigin href="/assets/index-mLBsqG2v.css">\n' +
'  </head>\n' +
'  <body class="bg-gray-50 min-h-screen">\n' +
'    <div id="root"></div>\n' +
'  </body>\n' +
'</html>';

// ===================== Generic Database (standalone, no external deps) =====================

// Simple crypto helper (no bcryptjs dependency)
function simpleHash(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    var chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return 'sha256:' + hash.toString(36);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
}

// ===================== Supabase Client (inline implementation) =====================

function createSupabaseQuery(url, key, table) {
  return {
    table: table,
    _filters: [],
    _order: null,
    _orderAsc: true,
    _limit: null,
    _single: false,
    _head: false,
    _insertBody: null,
    _updateBody: null,
    _range: null,

    eq: function(col, val) { this._filters.push({ col: col, op: 'eq', val: val }); return this; },
    neq: function(col, val) { this._filters.push({ col: col, op: 'neq', val: val }); return this; },
    like: function(col, val) { this._filters.push({ col: col, op: 'like', val: val }); return this; },
    not: function(col, op, val) { this._filters.push({ col: col, op: 'not', val: val, isNot: true }); return this; },
    in: function(col, vals) { this._filters.push({ col: col, op: 'in', val: vals }); return this; },
    order: function(col, opts) { this._order = col; this._orderAsc = !opts || opts.ascending !== false; return this; },
    limit: function(n) { this._limit = n; return this; },
    single: function() { this._single = true; return this; },
    maybeSingle: function() { this._single = 'maybe'; return this; },
    range: function(start, end) { this._range = [start, end]; return this; },
    select: function(cols, opts) {
      if (opts && opts.count === 'exact') this._head = true;
      return this._execute('GET', cols || '*', opts);
    },
    insert: function(body) { this._insertBody = body; return this._execute('POST', '*'); },
    upsert: function(body, opts) { this._insertBody = body; this._upsert = true; this._onConflict = opts ? opts.onConflict : null; return this._execute('POST', '*'); },
    update: function(body) { this._updateBody = body; return this._execute('PATCH', '*'); },
    delete: function() { return this._execute('DELETE', '*'); },

    _execute: async function(method, selectCols, opts) {
      var qs = (selectCols && selectCols !== '*') ? '?select=' + encodeURIComponent(selectCols) : '';
      if (opts && opts.head) qs += (qs ? '&' : '?') + 'head=true';
      if (opts && opts.count === 'exact') qs += (qs ? '&' : '?') + 'count=exact';

      for (var i = 0; i < this._filters.length; i++) {
        var f = this._filters[i];
        if (f.op === 'eq') qs += (qs ? '&' : '?') + f.col + '=eq.' + encodeURIComponent(f.val);
        else if (f.op === 'neq') qs += (qs ? '&' : '?') + f.col + '=neq.' + encodeURIComponent(f.val);
        else if (f.op === 'like') qs += (qs ? '&' : '?') + f.col + '=like.' + encodeURIComponent(f.val);
        else if (f.op === 'in') {
          var inStr = '(' + f.val.map(encodeURIComponent).join(',') + ')';
          qs += (qs ? '&' : '?') + f.col + '=in.' + inStr;
        }
      }

      if (this._order) {
        qs += (qs ? '&' : '?') + 'order=' + this._order + '.' + (this._orderAsc ? 'asc' : 'desc');
      }
      if (this._limit) qs += (qs ? '&' : '?') + 'limit=' + this._limit;
      if (this._range) {
        qs += (qs ? '&' : '?') + 'offset=' + this._range[0];
        qs += '&limit=' + (this._range[1] - this._range[0] + 1);
      }

      var headers = {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Prefer': this._single ? 'return=representation' : 'return=representation'
      };

      if (this._upsert) {
        headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
        if (this._onConflict) qs += (qs ? '&' : '?') + 'on_conflict=' + this._onConflict;
      }

      var fetchUrl = url + '/rest/v1/' + this.table + qs;
      var fetchOpts = { method: method, headers: headers };
      if (this._insertBody) fetchOpts.body = JSON.stringify(this._insertBody);
      if (this._updateBody) fetchOpts.body = JSON.stringify(this._updateBody);

      var resp = await fetch(fetchUrl, fetchOpts);
      var text = await resp.text();
      var data = null;
      try { if (text) data = JSON.parse(text); } catch (e) { data = text; }

      if (resp.status >= 400) {
        return { data: null, count: 0, error: data };
      }

      if (this._head || (opts && opts.head)) {
        return { data: null, count: parseInt(resp.headers.get('content-range') || '0') || 0, error: null };
      }

      if (this._single) {
        var result = Array.isArray(data) ? (data[0] || null) : data;
        if (this._single === 'maybe' && !result) result = null;
        return { data: result, count: data ? 1 : 0, error: null };
      }

      return { data: Array.isArray(data) ? data : [], count: Array.isArray(data) ? data.length : 0, error: null };
    }
  };
}

// ===================== Supabase Client =====================

var SUPABASE_URL = '';
var SUPABASE_KEY = '';

function initSupabase() {
  SUPABASE_URL = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) || '';
  SUPABASE_KEY = (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) || '';
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('缺少环境变量 SUPABASE_URL 或 SUPABASE_ANON_KEY');
  }
}

function supabaseQuery(table) {
  return createSupabaseQuery(SUPABASE_URL, SUPABASE_KEY, table);
}

// ===================== JWT =====================

var JWT_SECRET = '';

function initJWT() {
  JWT_SECRET = (typeof process !== 'undefined' && process.env && process.env.JWT_SECRET) || 'fde-platform-secret-key-2024';
}

// Simple base64url (no external deps)
function base64url(str) {
  var b64 = '';
  try { b64 = btoa(str); } catch (e) { b64 = Buffer.from(str).toString('base64'); }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  var decoded;
  try { decoded = atob(str); } catch (e) { decoded = Buffer.from(str, 'base64').toString('utf8'); }
  return decoded;
}

function generateToken(user) {
  var header = { alg: 'HS256', typ: 'JWT' };
  var now = Math.floor(Date.now() / 1000);
  var payload = { id: user.id, username: user.username, role: user.role, iat: now, exp: now + 86400 * 7 };
  var h = base64url(JSON.stringify(header));
  var p = base64url(JSON.stringify(payload));
  var signature = base64url(simpleHash(h + '.' + p + JWT_SECRET));
  return h + '.' + p + '.' + signature;
}

function verifyToken(token) {
  var parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  var payload = JSON.parse(base64urlDecode(parts[1]));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return payload;
}

function authRequired(request) {
  var header = request.headers ? (request.headers['authorization'] || request.headers.get ? request.headers.get('authorization') : null) : null;
  if (!header || !header.startsWith('Bearer ')) {
    return { error: '请先登录', status: 401 };
  }
  try {
    var token = header.split(' ')[1];
    var user = verifyToken(token);
    return { user: user };
  } catch (err) {
    return { error: '登录已过期，请重新登录', status: 401 };
  }
}

function adminRequired(user) {
  if (!user || user.role !== 'admin') {
    return { error: '需要管理员权限', status: 403 };
  }
  return {};
}

// ===================== Database =====================

async function ensureDefaults() {
  try {
    var adminCheck = await supabaseQuery('users').select('id').eq('role', 'admin').limit(1);
    if (!adminCheck.data || adminCheck.data.length === 0) {
      var admin = await supabaseQuery('users').insert({
        username: 'admin',
        password_hash: simpleHash('217310Was@'),
        email: 'admin@fde.com',
        role: 'admin'
      });
      if (admin.data) {
        await supabaseQuery('fde_profiles').insert({
          user_id: admin.data.id || admin.data[0].id,
          name: '管理员',
          title: '系统管理员',
          city: '深圳',
          description: 'FDE 平台管理员',
          email: 'admin@fde.com'
        });
      }
    }
  } catch (e) {
    console.error('[Init] ensureDefaults failed:', e.message);
  }
}

async function findUserByUsernameOrSuffix(username, password) {
  var hash = simpleHash(password);
  var exact = await supabaseQuery('users').select('*').eq('username', username).maybeSingle();
  if (exact.data && (exact.data.password_hash === hash || exact.data.password_hash === simpleHash(password))) {
    return exact.data;
  }
  var suffix = await supabaseQuery('users').select('*').like('username', username + '_%');
  if (suffix.data) {
    for (var i = 0; i < suffix.data.length; i++) {
      if (suffix.data[i].password_hash === hash) {
        return suffix.data[i];
      }
    }
  }
  return null;
}

async function findUserById(id) {
  var result = await supabaseQuery('users').select('*').eq('id', id).single();
  return result.data || null;
}

// ===================== API Handlers =====================

async function parseBody(request) {
  var contentType = '';
  try { contentType = request.headers.get('content-type') || ''; } catch (e) {}
  if (contentType.indexOf('application/json') !== -1) {
    try { return await request.json(); } catch (e) { return {}; }
  }
  return {};
}

async function handleAuthLogin(request) {
  var body = await parseBody(request);
  var username = body.username;
  var password = body.password;
  if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
  var user = await findUserByUsernameOrSuffix(username, password);
  if (!user) return json({ error: '用户名或密码错误' }, 401);
  var token = generateToken({ id: user.id, username: user.username, role: user.role });
  return json({ token: token, user: { id: user.id, username: user.username, role: user.role, email: user.email } });
}

async function handleAuthMe(request) {
  var auth = authRequired(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  var user = await findUserById(auth.user.id);
  if (!user) return json({ error: '用户不存在' }, 404);
  delete user.password_hash;
  return json(user);
}

async function handleFdeList(request) {
  var params = getQueryParams(request.url);
  var query = supabaseQuery('fde_profiles').select('*').neq('name', '').not('name', 'is', null);
  if (params.city && params.city !== '全部' && params.city !== 'all') {
    query = query.eq('city', params.city);
  }
  query = query.order('updated_at', { ascending: false });
  var result = await query;
  return json(result.data || []);
}

// ===================== Router =====================

async function handleAPI(path, method, request) {
  // Health check
  if (path === '/api/health' && method === 'GET') {
    return json({ status: 'ok', timestamp: new Date().toISOString(), runtime: 'node-functions' });
  }

  // Auth
  if (path === '/api/auth/login' && method === 'POST') return await handleAuthLogin(request);
  if (path === '/api/auth/me' && method === 'GET') return await handleAuthMe(request);

  // FDE
  if (path === '/api/fde' && method === 'GET') return await handleFdeList(request);

  return json({ error: 'Not Found', path: path }, 404);
}

// ===================== Main Entry =====================

async function onRequest(context) {
  var request = context.request;
  var urlStr = request.url;

  // CORS preflight
  if (request.method === 'OPTIONS') {
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
  var method = request.method.toUpperCase();

  // Initialize services
  try {
    initSupabase();
    initJWT();
    await ensureDefaults();
  } catch (initErr) {
    console.error('[Init]', initErr.message);
  }

  // API routes
  if (path.startsWith('/api/')) {
    try {
      return await handleAPI(path, method, request);
    } catch (err) {
      console.error('[API Error]', err.message);
      return json({ error: '服务器内部错误: ' + err.message, detail: (err.stack || '') }, 500);
    }
  }

  // SPA fallback
  return new Response(SPA_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

module.exports = { onRequest };
