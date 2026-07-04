/**
 * EdgeOne Pages Edge Function - Complete FDE Backend
 *
 * - /api/*  → JSON API (auth, fde, articles)
 * - /*      → SPA fallback
 * Zero external dependencies: Supabase via fetch(), JWT inline
 */

// ===================== Helpers =====================

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

function getQueryParams(url) {
  var fullUrl = url.startsWith('http') ? url : 'http://localhost' + url;
  var parsed = new URL(fullUrl);
  var params = {};
  parsed.searchParams.forEach(function (v, k) { params[k] = v; });
  return params;
}

async function parseBody(request) {
  try {
    var ct = request.headers.get('content-type') || '';
    if (ct.indexOf('application/json') !== -1) return await request.json();
  } catch (e) {}
  return {};
}

function now() {
  return new Date().toISOString();
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
'  <body class="bg-gray-50 min-h-screen"><div id="root"></div></body>\n' +
'</html>';

// ===================== Simple Hash (replaces bcryptjs) =====================

function simpleHash(str) {
  // Deterministic hash using a simple algorithm
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return 'h:' + (hash >>> 0).toString(36);
}

// ===================== Supabase Client (inline via fetch) =====================

var _SUPABASE_URL = '';
var _SUPABASE_KEY = '';

function initSupabase(env) {
  _SUPABASE_URL = (env && env.SUPABASE_URL) || '';
  _SUPABASE_KEY = (env && env.SUPABASE_ANON_KEY) || '';
  if (!_SUPABASE_URL || !_SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment');
  }
}

function sb(table) {
  var q = {
    _table: table,
    _filters: [],
    _order: null,
    _orderAsc: true,
    _limit: null,
    _offset: null,
    _single: false,
    _maybeSingle: false,
    _head: false,
    _count: '',
    _body: null,
    _method: null,

    eq: function(c, v) { this._filters.push({ op: 'eq', c: c, v: String(v) }); return this; },
    neq: function(c, v) { this._filters.push({ op: 'neq', c: c, v: String(v) }); return this; },
    like: function(c, v) { this._filters.push({ op: 'like', c: c, v: String(v) }); return this; },
    is: function(c, v) { this._filters.push({ op: 'is', c: c, v: String(v) }); return this; },
    not: function(c, op, v) { this._filters.push({ op: 'not', c: c, subOp: op, v: String(v), isNot: true }); return this; },
    in: function(c, arr) { this._filters.push({ op: 'in', c: c, v: arr.map(String).join(',') }); return this; },
    order: function(c, opts) { this._order = c; this._orderAsc = !opts || opts.ascending !== false; return this; },
    limit: function(n) { this._limit = n; return this; },
    range: function(s, e) { this._offset = s; this._limit = e - s + 1; return this; },
    single: function() { this._single = true; return this; },
    maybeSingle: function() { this._maybeSingle = true; return this; },

    select: function(cols, opts) {
      if (!cols) cols = '*';
      this._method = 'GET';
      this._selectCols = cols;
      if (opts && opts.count === 'exact') this._count = 'exact';
      if (opts && opts.head === true) this._head = true;
      return this._exec();
    },
    insert: function(body) {
      this._method = 'POST';
      this._body = body;
      this._selectCols = '*';
      return this._exec();
    },
    upsert: function(body, opts) {
      this._method = 'POST';
      this._body = body;
      this._upsert = true;
      if (opts && opts.onConflict) this._onConflict = opts.onConflict;
      this._selectCols = '*';
      return this._exec();
    },
    update: function(body) {
      this._method = 'PATCH';
      this._body = body;
      this._selectCols = '*';
      return this._exec();
    },
    delete: function() {
      this._method = 'DELETE';
      this._selectCols = '*';
      return this._exec();
    },

    _buildQS: function() {
      var qs = '';
      if (this._selectCols && this._selectCols !== '*' && this._method === 'GET') qs += '?select=' + encodeURIComponent(this._selectCols);
      else if (this._method === 'GET') qs += '?select=*';

      for (var i = 0; i < this._filters.length; i++) {
        var f = this._filters[i];
        if (f.isNot) {
          qs += '&' + f.c + '=not.' + f.subOp + '.' + encodeURIComponent(f.v);
          continue;
        }
        switch (f.op) {
          case 'eq':   qs += '&' + f.c + '=eq.' + encodeURIComponent(f.v); break;
          case 'neq':  qs += '&' + f.c + '=neq.' + encodeURIComponent(f.v); break;
          case 'like': qs += '&' + f.c + '=like.' + encodeURIComponent(f.v); break;
          case 'is':   qs += '&' + f.c + '=is.' + encodeURIComponent(f.v); break;
          case 'in':   qs += '&' + f.c + '=in.(' + f.v + ')'; break;
        }
      }

      if (this._order) qs += '&order=' + this._order + '.' + (this._orderAsc ? 'asc' : 'desc');
      if (this._limit !== null && this._offset === null) qs += '&limit=' + this._limit;
      if (this._offset !== null && this._limit !== null) { qs += '&offset=' + this._offset + '&limit=' + this._limit; }
      if (this._count === 'exact') qs += (qs ? '' : '?') + '&head=true& Prefer=count=exact';
      if (this._upsert) qs += '&Prefer=resolution%3Amerge-duplicates%2Creturn%3Arepresentation';
      if (this._onConflict) qs += '&on_conflict=' + this._onConflict;

      return qs;
    },

    _headers: function() {
      var h = {
        'apikey': _SUPABASE_KEY,
        'Authorization': 'Bearer ' + _SUPABASE_KEY,
        'Content-Type': 'application/json'
      };
      if (this._upsert) h['Prefer'] = 'resolution=merge-duplicates,return=representation';
      else if (this._method !== 'GET' && this._method !== 'DELETE') h['Prefer'] = 'return=representation';
      return h;
    },

    _exec: async function() {
      var base = _SUPABASE_URL + '/rest/v1/' + q._table + q._buildQS();
      var init = { method: q._method, headers: q._headers() };
      if (q._body) init.body = JSON.stringify(q._body);

      var resp = await fetch(base, init);
      var text = await resp.text();

      if (resp.status >= 400) {
        var errData = null;
        try { errData = JSON.parse(text); } catch (e) {}
        return { data: null, error: errData || text, count: 0 };
      }

      if (text === '' || text === 'null') {
        if (q._maybeSingle) return { data: null, error: null, count: 0 };
        return { data: [], error: null, count: 0 };
      }

      var data = JSON.parse(text);

      if (q._single || q._maybeSingle) {
        return { data: Array.isArray(data) ? (data[0] || null) : data, error: null, count: data ? 1 : 0 };
      }
      if (q._head) {
        var cr = resp.headers.get('content-range') || '';
        var total = cr.split('/')[1];
        return { data: null, error: null, count: parseInt(total) || 0 };
      }

      return { data: Array.isArray(data) ? data : [data], error: null, count: Array.isArray(data) ? data.length : 1 };
    }
  };

  return q;
}

// ===================== JWT (inline, no jsonwebtoken) =====================

var JWT_SECRET = '';

function initJWT(env) {
  JWT_SECRET = (env && env.JWT_SECRET) || 'fde-platform-secret-key-2024';
}

function b64urlEncode(str) {
  try {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  } catch (e) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}

function b64urlDecode(str) {
  str = (str + '===').slice(0, str.length + (4 - str.length % 4) % 4);
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    var binary = atob(str);
    bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function generateToken(user) {
  var header = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var ts = Math.floor(Date.now() / 1000);
  var payload = b64urlEncode(JSON.stringify({
    id: user.id, username: user.username, role: user.role, iat: ts, exp: ts + 604800
  }));
  var sig = b64urlEncode(simpleHash(header + '.' + payload + JWT_SECRET));
  return header + '.' + payload + '.' + sig;
}

function verifyToken(token) {
  var parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token');
  var payload = JSON.parse(b64urlDecode(parts[1]));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('token expired');
  return payload;
}

// ===================== Auth Helpers =====================

function authRequired(request) {
  var authHeader = '';
  try { authHeader = request.headers.get('authorization') || ''; } catch (e) {}
  if (!authHeader.startsWith('Bearer ')) return { error: '请先登录', status: 401 };
  try {
    var user = verifyToken(authHeader.substring(7));
    return { user: user };
  } catch (e) {
    return { error: '登录已过期，请重新登录', status: 401 };
  }
}

function adminRequired(user) {
  if (!user || user.role !== 'admin') return { error: '需要管理员权限', status: 403 };
  return {};
}

// ===================== Database Operations =====================

async function ensureDefaults() {
  try {
    var r = await sb('users').select('id').eq('role', 'admin').limit(1);
    if (r.data && r.data.length > 0) return;

    var admin = await sb('users').insert({
      username: 'admin', password_hash: simpleHash('217310Was@'),
      email: 'admin@fde.com', role: 'admin', created_at: now()
    });

    if (admin.error) throw new Error(admin.error.message || 'Failed to create admin');

    var uid = admin.data.id;
    if (!uid) uid = admin.data[0].id;

    await sb('fde_profiles').insert({
      user_id: uid, name: '管理员', title: '系统管理员',
      city: '深圳', description: 'FDE 平台管理员', email: 'admin@fde.com',
      avatar_url: '', wechat_qr_url: '', created_at: now(), updated_at: now()
    });
  } catch (e) {
    console.error('[Init] ensureDefaults:', e.message);
  }
}

// ===================== Auth Handlers =====================

async function handleHealth() {
  return json({
    status: 'ok', timestamp: now(),
    runtime: 'edge-functions',
    supabase_configured: !!_SUPABASE_URL
  });
}

async function handleLogin(request) {
  var body = await parseBody(request);
  var u = body.username, p = body.password;
  if (!u || !p) return json({ error: '用户名和密码不能为空' }, 400);

  var r = await sb('users').select('*').eq('username', u).maybeSingle();
  if (r.error) return json({ error: '查询失败' }, 500);
  if (!r.data || r.data.password_hash !== simpleHash(p)) return json({ error: '用户名或密码错误' }, 401);

  var user = r.data;
  delete user.password_hash;
  return json({ token: generateToken(user), user: user });
}

async function handleRegister(request) {
  var body = await parseBody(request);
  var u = body.username, p = body.password, email = body.email || '';
  if (!u || !p) return json({ error: '用户名和密码不能为空' }, 400);

  var ex = await sb('users').select('id').eq('username', u).maybeSingle();
  if (ex.data) return json({ error: '用户名已存在' }, 409);

  var cr = await sb('users').insert({
    username: u, password_hash: simpleHash(p),
    email: email, role: 'user', created_at: now()
  });
  if (cr.error) return json({ error: '注册失败: ' + (cr.error.message || 'unknown') }, 500);

  var uid = cr.data.id;
  if (!uid) uid = cr.data[0].id;

  await sb('fde_profiles').insert({
    user_id: uid, name: u, title: '', city: '', description: '',
    email: email, avatar_url: '', wechat_qr_url: '',
    created_at: now(), updated_at: now()
  });

  return json({ token: generateToken({ id: uid, username: u, role: 'user' }), user: { id: uid, username: u, role: 'user', email: email } });
}

async function handleAuthMe(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var r = await sb('users').select('*').eq('id', a.user.id).single();
  if (!r.data) return json({ error: '用户不存在' }, 404);
  delete r.data.password_hash;
  return json(r.data);
}

async function handlePassword(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var body = await parseBody(request);
  var oldPw = body.oldPassword, newPw = body.newPassword;
  if (!oldPw || !newPw) return json({ error: '请提供原密码和新密码' }, 400);

  var r = await sb('users').select('*').eq('id', a.user.id).single();
  if (!r.data) return json({ error: '用户不存在' }, 404);
  if (r.data.password_hash !== simpleHash(oldPw)) return json({ error: '原密码错误' }, 401);

  await sb('users').update({ password_hash: simpleHash(newPw) }).eq('id', a.user.id);
  return json({ message: '密码修改成功' });
}

async function handleAuthUsers(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  var r = await sb('users').select('id,username,email,role,created_at').order('created_at', { ascending: false });
  return json(r.data || []);
}

async function handleResetToAdmin(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  // Delete all non-admin users and their profiles
  var users = await sb('users').select('id').neq('role', 'admin');
  if (users.data) {
    for (var i = 0; i < users.data.length; i++) {
      await sb('fde_profiles').delete().eq('user_id', users.data[i].id);
      await sb('pending_profiles').delete().eq('user_id', users.data[i].id);
      await sb('users').delete().eq('id', users.data[i].id);
    }
  }
  return json({ message: '数据已重置，仅保留管理员账户' });
}

async function handleUserRole(request, userId) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  var body = await parseBody(request);
  var role = body.role;
  if (!['user', 'admin'].includes(role)) return json({ error: '无效的角色' }, 400);
  var r = await sb('users').update({ role: role }).eq('id', userId);
  if (r.error) return json({ error: '更新失败' }, 500);
  return json({ message: '角色已更新为 ' + role });
}

// ===================== FDE Handlers =====================

async function handleFdeList(request) {
  var params = getQueryParams(request.url);
  var q = sb('fde_profiles').select('*').not('name', 'is', null).neq('name', '');
  if (params.city && params.city !== '全部' && params.city !== 'all') q = q.eq('city', params.city);
  q = q.order('updated_at', { ascending: false });
  var r = await q;
  return json(r.data || []);
}

async function handleFdeCities() {
  var r = await sb('fde_profiles').select('city').not('city', 'is', null).neq('city', '');
  var cities = [], seen = {};
  if (r.data) for (var i = 0; i < r.data.length; i++) { var c = r.data[i].city; if (c && !seen[c]) { seen[c] = true; cities.push(c); } }
  return json(cities);
}

async function handleFdeProfile(request, userId) {
  var r = await sb('fde_profiles').select('*').eq('user_id', userId).maybeSingle();
  if (!r.data) return json({ error: 'FDE 信息不存在' }, 404);
  return json(r.data);
}

async function handleFdeMyPending(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var r = await sb('pending_profiles').select('*').eq('user_id', a.user.id).maybeSingle();
  if (!r.data) return json({ reviewed: true, profile: {} });
  return json({ reviewed: false, profile: r.data.profile_data || {} });
}

async function handleFdeReviews(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  var r = await sb('pending_profiles').select('*,fde_profiles(name)').order('created_at', { ascending: false });
  return json(r.data || []);
}

async function handleFdeReviewApprove(request, reviewId) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  var review = await sb('pending_profiles').select('*').eq('id', reviewId).maybeSingle();
  if (!review.data) return json({ error: '审核记录不存在' }, 404);
  var pd = review.data.profile_data || {};
  pd.updated_at = now();
  var existing = await sb('fde_profiles').select('id').eq('user_id', review.data.user_id).maybeSingle();
  if (existing.data) {
    await sb('fde_profiles').update(pd).eq('user_id', review.data.user_id);
  } else {
    pd.user_id = review.data.user_id;
    await sb('fde_profiles').insert(pd);
  }
  await sb('pending_profiles').delete().eq('id', reviewId);
  return json({ approved: true });
}

async function handleFdeReviewReject(request, reviewId) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  await sb('pending_profiles').delete().eq('id', reviewId);
  return json({ rejected: true });
}

async function handleFdeReviewUpdate(request, reviewId) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var ac = adminRequired(a.user);
  if (ac.error) return json(ac, ac.status);
  var review = await sb('pending_profiles').select('*').eq('id', reviewId).maybeSingle();
  if (!review.data) return json({ error: '审核记录不存在' }, 404);
  var body = await parseBody(request);
  var pd = Object.assign({}, review.data.profile_data, body);
  pd.updated_at = now();
  await sb('pending_profiles').update({ profile_data: pd }).eq('id', reviewId);
  return json(await sb('pending_profiles').select('*').eq('id', reviewId).maybeSingle());
}

async function handleFdeUpdateProfile(request, userId) {
  if (isNaN(userId)) return json({ error: '无效的用户ID' }, 400);
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var body = await parseBody(request);
  var fields = {};
  var allowed = ['name', 'title', 'city', 'description', 'work_details', 'resources_needed', 'skills', 'email', 'phone'];
  for (var k of allowed) if (body[k] !== undefined) fields[k] = body[k];

  if (a.user.role === 'admin') {
    fields.updated_at = now();
    var r = await sb('fde_profiles').update(fields).eq('user_id', userId);
    if (!r.data) return json({ error: 'FDE 信息不存在' }, 404);
    if (body.wechat_qr_url !== undefined) await sb('fde_profiles').update({ wechat_qr_url: body.wechat_qr_url }).eq('user_id', userId);
    var profile = await sb('fde_profiles').select('*').eq('user_id', userId).single();
    return json(Object.assign({}, profile.data, { reviewed: true }));
  }

  // Non-admin: save to pending
  var current = await sb('fde_profiles').select('*').eq('user_id', userId).maybeSingle();
  var merged = current.data ? Object.assign({}, current.data, fields) : fields;
  merged.updated_at = now();

  var existingRv = await sb('pending_profiles').select('id').eq('user_id', userId).maybeSingle();
  if (existingRv.data) {
    await sb('pending_profiles').update({ profile_data: merged }).eq('user_id', userId);
  } else {
    await sb('pending_profiles').insert({ user_id: userId, profile_data: merged });
  }

  var profile = await sb('fde_profiles').select('*').eq('user_id', userId).maybeSingle();
  return json(Object.assign({ reviewed: false, message: '资料已提交审核' }, profile.data || {}));
}

async function handleFdeDeleteProfile(request, userId) {
  if (isNaN(userId)) return json({ error: '无效的用户ID' }, 400);
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  if (a.user.role !== 'admin') return json({ error: '仅管理员可删除 FDE 信息' }, 403);
  await sb('fde_profiles').delete().eq('user_id', userId);
  await sb('pending_profiles').delete().eq('user_id', userId);
  return json({ deleted: true });
}

async function handleFdeUploadAvatar(request, userId) {
  if (isNaN(userId)) return json({ error: '无效的用户ID' }, 400);
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  if (a.user.role !== 'admin' && a.user.id !== userId) return json({ error: '只能修改自己的头像' }, 403);
  var body = await parseBody(request);
  var avatar = body.avatar;
  if (!avatar) return json({ error: '请上传图片' }, 400);

  if (a.user.role === 'admin') {
    await sb('fde_profiles').update({ avatar_url: avatar }).eq('user_id', userId);
    return json({ url: avatar, reviewed: true });
  }

  var current = await sb('fde_profiles').select('*').eq('user_id', userId).maybeSingle();
  var merged = current.data ? Object.assign({}, current.data, { avatar_url: avatar }) : { avatar_url: avatar };
  merged.updated_at = now();

  var rv = await sb('pending_profiles').select('id').eq('user_id', userId).maybeSingle();
  if (rv.data) await sb('pending_profiles').update({ profile_data: merged }).eq('user_id', userId);
  else await sb('pending_profiles').insert({ user_id: userId, profile_data: merged });

  return json({ url: avatar, reviewed: false, message: '头像已提交审核' });
}

async function handleFdeUploadQrCode(request, userId) {
  if (isNaN(userId)) return json({ error: '无效的用户ID' }, 400);
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  if (a.user.role !== 'admin' && a.user.id !== userId) return json({ error: '只能修改自己的二维码' }, 403);
  var body = await parseBody(request);
  var qr = body.qrcode;
  if (!qr) return json({ error: '请上传图片' }, 400);

  if (a.user.role === 'admin') {
    await sb('fde_profiles').update({ wechat_qr_url: qr }).eq('user_id', userId);
    return json({ url: qr, reviewed: true });
  }

  var current = await sb('fde_profiles').select('*').eq('user_id', userId).maybeSingle();
  var merged = current.data ? Object.assign({}, current.data, { wechat_qr_url: qr }) : { wechat_qr_url: qr };
  merged.updated_at = now();

  var rv = await sb('pending_profiles').select('id').eq('user_id', userId).maybeSingle();
  if (rv.data) await sb('pending_profiles').update({ profile_data: merged }).eq('user_id', userId);
  else await sb('pending_profiles').insert({ user_id: userId, profile_data: merged });

  return json({ url: qr, reviewed: false, message: '二维码已提交审核' });
}

// ===================== Articles Handlers =====================

async function handleArticlesList(request) {
  var params = getQueryParams(request.url);
  var page = parseInt(params.page) || 1;
  var limit = parseInt(params.limit) || 12;
  var offset = (page - 1) * limit;
  var q = sb('articles').select('*,users(id,username)');
  if (params.category && params.category !== 'all') q = q.eq('category', params.category);
  var r = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  var countR = await sb('articles').select('*', { head: true, count: 'exact' });
  return json({ items: r.data || [], total: countR.count, page: page, limit: limit });
}

async function handleArticleGet(id) {
  var r = await sb('articles').select('*,users(username)').eq('id', id).single();
  if (!r.data) return json({ error: '文章不存在' }, 404);
  return json(r.data);
}

async function handleArticleCreate(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var body = await parseBody(request);
  if (!body.title || !body.content) return json({ error: '标题和内容不能为空' }, 400);
  var r = await sb('articles').insert({
    author_id: a.user.id, title: body.title,
    summary: body.summary || '', content: body.content,
    category: body.category || '技术分享',
    cover_url: body.cover_url || '',
    created_at: now(), updated_at: now()
  });
  if (r.error) return json({ error: '创建失败' }, 500);
  return json(r.data);
}

async function handleArticleUpdate(request, id) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var article = await sb('articles').select('*').eq('id', id).maybeSingle();
  if (!article.data) return json({ error: '文章不存在' }, 404);
  var body = await parseBody(request);
  var fields = {};
  ['title', 'summary', 'content', 'category', 'cover_url'].forEach(function(k) { if (body[k] !== undefined) fields[k] = body[k]; });
  fields.updated_at = now();
  var r = await sb('articles').update(fields).eq('id', id);
  return json(r.data);
}

async function handleArticleDelete(request, id) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var article = await sb('articles').select('*').eq('id', id).maybeSingle();
  if (!article.data) return json({ error: '文章不存在' }, 404);
  await sb('articles').delete().eq('id', id);
  return json({ deleted: true });
}

async function handleArticleUploadCover(request) {
  var a = authRequired(request);
  if (a.error) return json(a, a.status);
  var body = await parseBody(request);
  if (!body.cover_url) return json({ error: '请上传封面图' }, 400);
  return json({ cover_url: body.cover_url });
}

// ===================== Router =====================

async function handleAPI(path, method, request) {
  // Health
  if (path === '/api/health' && method === 'GET') return await handleHealth();

  // Test env
  if (path === '/api/test-env' && method === 'GET') return json({ envKeys: Object.keys(_envCache || {}) });

  // Auth
  if (path === '/api/auth/login' && method === 'POST') return await handleLogin(request);
  if (path === '/api/auth/register' && method === 'POST') return await handleRegister(request);
  if (path === '/api/auth/me' && method === 'GET') return await handleAuthMe(request);
  if (path === '/api/auth/password' && method === 'PUT') return await handlePassword(request);
  if (path === '/api/auth/users' && method === 'GET') return await handleAuthUsers(request);
  if (path === '/api/auth/reset-to-admin' && method === 'POST') return await handleResetToAdmin(request);

  // FDE list & cities
  if (path === '/api/fde' && method === 'GET') return await handleFdeList(request);
  if (path === '/api/fde/cities' && method === 'GET') return await handleFdeCities();

  // FDE with ID
  var m;
  if ((m = path.match(/^\/api\/fde\/(\d+)$/))) {
    if (method === 'GET') return await handleFdeProfile(request, parseInt(m[1]));
    if (method === 'PUT') return await handleFdeUpdateProfile(request, parseInt(m[1]));
    if (method === 'DELETE') return await handleFdeDeleteProfile(request, parseInt(m[1]));
  }
  if ((m = path.match(/^\/api\/fde\/(\d+)\/avatar$/)) && method === 'POST')
    return await handleFdeUploadAvatar(request, parseInt(m[1]));
  if ((m = path.match(/^\/api\/fde\/(\d+)\/qrcode$/)) && method === 'POST')
    return await handleFdeUploadQrCode(request, parseInt(m[1]));

  // FDE pending/reviews
  if (path === '/api/fde/my-pending' && method === 'GET') return await handleFdeMyPending(request);
  if (path === '/api/fde/reviews' && method === 'GET') return await handleFdeReviews(request);

  // Review actions
  if ((m = path.match(/^\/api\/fde\/reviews\/(\d+)\/approve$/)) && method === 'POST')
    return await handleFdeReviewApprove(request, parseInt(m[1]));
  if ((m = path.match(/^\/api\/fde\/reviews\/(\d+)\/reject$/)) && method === 'POST')
    return await handleFdeReviewReject(request, parseInt(m[1]));
  if ((m = path.match(/^\/api\/fde\/reviews\/(\d+)$/)))
    return await handleFdeReviewUpdate(request, parseInt(m[1]));

  // User role
  if ((m = path.match(/^\/api\/auth\/users\/(\d+)\/role$/)) && method === 'PUT')
    return await handleUserRole(request, parseInt(m[1]));

  // Articles
  if (path === '/api/articles' && method === 'GET') return await handleArticlesList(request);
  if (path === '/api/articles/categories' && method === 'GET')
    return json(['技术分享', '行业动态', '项目案例', '学习笔记']);
  if ((m = path.match(/^\/api\/articles\/(\d+)$/))) {
    if (method === 'GET') return await handleArticleGet(parseInt(m[1]));
    if (method === 'PUT') return await handleArticleUpdate(request, parseInt(m[1]));
    if (method === 'DELETE') return await handleArticleDelete(request, parseInt(m[1]));
  }
  if (path === '/api/articles/create' && method === 'POST') return await handleArticleCreate(request);
  if (path === '/api/articles/upload-cover' && method === 'POST') return await handleArticleUploadCover(request);

  return json({ error: 'Not Found', path: path }, 404);
}

// ===================== Main Entry =====================

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

  // Parse URL
  var url;
  try { url = new URL(urlStr.startsWith('http') ? urlStr : 'http://localhost' + urlStr); }
  catch (e) { url = new URL('http://localhost/' + urlStr); }
  var path = url.pathname;

  // Init services
  try {
    initSupabase(env);
    initJWT(env);
    await ensureDefaults();
  } catch (initErr) {
    console.error('[Init]', initErr.message);
    // Continue anyway for health check
  }

  // API routes
  if (path.startsWith('/api/')) {
    try { return await handleAPI(path, method, request); }
    catch (err) {
      console.error('[API]', err.message, err.stack || '');
      return json({ error: '服务器内部错误: ' + err.message }, 500);
    }
  }

  // SPA fallback
  return new Response(SPA_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
