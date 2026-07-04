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

  // ---- polyfill: atob / btoa (not available in all edge runtimes) ----
  var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  function _safeBtoa(str) {
    var out = '', i = 0, c1, c2, c3;
    while (i < str.length) {
      c1 = str.charCodeAt(i++) & 0xff;
      if (i === str.length) { out += B64CHARS.charAt(c1 >> 2) + B64CHARS.charAt((c1 & 0x3) << 4) + '=='; break; }
      c2 = str.charCodeAt(i++);
      if (i === str.length) { out += B64CHARS.charAt(c1 >> 2) + B64CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4)) + B64CHARS.charAt((c2 & 0xf) << 2) + '='; break; }
      c3 = str.charCodeAt(i++);
      out += B64CHARS.charAt(c1 >> 2) + B64CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4)) + B64CHARS.charAt(((c2 & 0xf) << 2) | ((c3 & 0xc0) >> 6)) + B64CHARS.charAt(c3 & 0x3f);
    }
    return out;
  }
  function _safeAtob(b64) {
    b64 = b64.replace(/[^A-Za-z0-9\+\/\=]/g, '');
    var out = '', i = 0, c1, c2, c3, e1, e2, e3, e4;
    while (i < b64.length) {
      e1 = B64CHARS.indexOf(b64.charAt(i++));
      e2 = B64CHARS.indexOf(b64.charAt(i++));
      e3 = B64CHARS.indexOf(b64.charAt(i++));
      e4 = B64CHARS.indexOf(b64.charAt(i++));
      c1 = (e1 << 2) | (e2 >> 4);
      out += String.fromCharCode(c1);
      if (e3 !== 64) {
        c2 = ((e2 & 15) << 4) | (e3 >> 2);
        out += String.fromCharCode(c2);
      }
      if (e4 !== 64) {
        c3 = ((e3 & 3) << 6) | e4;
        out += String.fromCharCode(c3);
      }
    }
    return out;
  }

  function tokenPayload(data) {
    var parts = [];
    Object.keys(data).forEach(function(k) { parts.push(k + '=' + encodeURIComponent(data[k])); });
    return parts.join('&');
  }

  function signToken(user) {
    var ts = Math.floor(Date.now() / 1000);
    var payload = tokenPayload({ i: String(user.id), u: user.username, r: user.role, t: String(ts) });
    var sig = hash(payload + '-JWT');
    return 'v1.' + _safeBtoa(payload) + '.' + sig;
  }

  function verifyToken(token) {
    if (!token) return null;
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    var payload;
    try { payload = _safeAtob(parts[1]); } catch(e) { return null; }
    if (!payload || payload.indexOf('=') < 0) return null;
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
    if (!header || !header.startsWith('Bearer ')) return null;
    return verifyToken(header.substring(7));
  }

  // ====== Supabase (simple fetch wrapper) ======

  var SB_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  var SB_KEY = env.SUPABASE_ANON_KEY || '';

  async function supabaseREST(table, method, body, queryParts) {
    if (!SB_URL || !SB_KEY) return { error: 'Supabase not configured' };
    try {
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
    } catch(e) {
      return { error: 'fetch failed: ' + (e.message || 'unknown error'), status: 0 };
    }
  }

  // ====== Supabase Storage upload helper ======
  async function uploadToStorage(fileBuffer, fileName, fileType) {
    if (!SB_URL || !SB_KEY) return { error: 'Supabase not configured' };
    var ext = (fileName || 'file.png').split('.').pop().toLowerCase();
    var allowed = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    if (allowed.indexOf(ext) < 0) return { error: '不支持的文件格式，请上传 PNG/JPG/JPEG/GIF/WebP' };
    if (fileBuffer.byteLength > 5 * 1024 * 1024) return { error: '文件大小不能超过 5MB' };

    var uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + '.' + ext;
    var bucket = 'fde-uploads';

    // Ensure bucket exists (ignore error if already exists)
    try {
      var bucketCheck = await fetch(SB_URL + '/storage/v1/bucket/' + bucket, {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      if (bucketCheck.status === 404) {
        await fetch(SB_URL + '/storage/v1/bucket', {
          method: 'POST',
          headers: {
            'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: bucket, public: true,
            file_size_limit: 5242880,
            allowed_mime_types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
          })
        });
      }
    } catch(e) {}

    // Upload file
    var uploadUrl = SB_URL + '/storage/v1/object/' + bucket + '/' + uniqueName;
    try {
      var resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': fileType || 'application/octet-stream'
        },
        body: fileBuffer
      });
      if (resp.status >= 400) {
        var errText = await resp.text();
        return { error: '上传失败 ' + resp.status + ': ' + errText };
      }
    } catch(e) {
      return { error: '上传失败: ' + (e.message || 'unknown') };
    }

    var publicUrl = SB_URL + '/storage/v1/object/public/' + bucket + '/' + uniqueName;
    return { url: publicUrl, name: uniqueName };
  }

  // Delete old file from storage
  async function deleteFromStorage(fileUrl) {
    if (!fileUrl || !SB_URL || !SB_KEY) return;
    var bucket = 'fde-uploads';
    var idx = fileUrl.indexOf('/' + bucket + '/');
    if (idx < 0) return;
    var objPath = fileUrl.substring(idx + bucket.length + 2);
    try {
      await fetch(SB_URL + '/storage/v1/object/' + bucket + '/' + encodeURIComponent(objPath), {
        method: 'DELETE',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
    } catch(e) {}
  }

  // ====== Seed admin account ======
  // 首次访问自动创建管理员账号，避免空数据库无法登录
  var _seeded = false;
  async function ensureAdmin() {
    if (_seeded) return;
    try {
      var check = await supabaseREST('users', 'GET', null, ['select=id', 'role=eq.admin']);
      var count = 0;
      if (!check.error && check.data && Array.isArray(check.data)) {
        count = check.data.length;
      }
      if (count === 0) {
        var cr = await supabaseREST('users', 'POST', {
          username: 'admin',
          password_hash: hash('217310Was@'),
          email: 'admin@fde.com',
          role: 'admin',
          created_at: now()
        }, ['select=*']);
        if (!cr.error) {
          var u = Array.isArray(cr.data) ? cr.data[0] : cr.data;
          if (u && u.id) {
            await supabaseREST('fde_profiles', 'POST', {
              user_id: u.id,
              name: '管理员',
              title: '系统管理员',
              city: '深圳',
              description: 'FDE 平台管理员',
              email: 'admin@fde.com',
              created_at: now(),
              updated_at: now()
            });
          }
        }
      }
    } catch(e) {}
    _seeded = true;
  }

  // ====== API handlers ======

  // /api/seed — 手动初始化管理员账号
  if (path === '/api/seed' && method === 'GET') {
    _seeded = false;
    await ensureAdmin();
    return json({ ok: true, message: '管理员账号已初始化', account: 'admin / 217310Was@' });
  }

  // /api/token-test — 测试 token 生成和验证
  if (path === '/api/token-test' && method === 'GET') {
    var testUser = { id: 1, username: 'test', role: 'admin' };
    var token = signToken(testUser);
    var verified = verifyToken(token);
    return json({
      signed_token: token,
      verified: verified ? { id: verified.id, username: verified.username, role: verified.role } : null,
      match: verified && verified.id === testUser.id
    });
  }

  // /api/health
  if (path === '/api/health' && method === 'GET') {
    return json({
      status: 'ok', timestamp: now(),
      supabase_url: SB_URL ? 'configured' : 'missing',
      supabase_key: SB_KEY ? 'configured' : 'missing',
      version: 'edge-v2.5-admin-delete-user-and-card'
    });
  }

  // /api/diag/approve-test — simulate approve flow to verify fde_profiles gets written
  if (path === '/api/diag/approve-test' && method === 'GET') {
    var diag = {};
    var testUserId = -88888;
    var testProfileData = { name: '__approve_test__', title: '测试', city: '深圳', description: '诊断测试' };

    // 1. Ensure a test fde_profiles row doesn't exist from a previous run
    await supabaseREST('fde_profiles', 'DELETE', null, ['user_id=eq.' + testUserId]);

    // 2. Simulate what approve does: PATCH with user_id filter
    var patchRes = await supabaseREST('fde_profiles', 'PATCH', Object.assign({}, testProfileData, { updated_at: now() }), ['user_id=eq.' + testUserId, 'select=*']);
    diag.step1_patch = {
      error: patchRes.error || null,
      rowsAffected: patchRes.data ? (Array.isArray(patchRes.data) ? patchRes.data.length : 1) : 0
    };

    // 3. If PATCH returned 0 rows, fall back to INSERT
    var rowsAffected = patchRes.data ? (Array.isArray(patchRes.data) ? patchRes.data.length : 1) : 0;
    if (!patchRes.error && rowsAffected === 0) {
      var insRes = await supabaseREST('fde_profiles', 'POST', Object.assign({
        user_id: testUserId, created_at: now(), updated_at: now()
      }, testProfileData), ['select=*']);
      diag.step2_insert_fallback = {
        error: insRes.error || null,
        rowsInserted: insRes.data ? (Array.isArray(insRes.data) ? insRes.data.length : 1) : 0
      };
    } else {
      diag.step2_insert_fallback = 'skipped (PATCH matched rows)';
    }

    // 4. Verify: read back from fde_profiles
    var verify = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=eq.' + testUserId]);
    diag.step3_verify = {
      error: verify.error || null,
      found: verify.data && verify.data.length > 0,
      data: verify.data || null
    };

    // 5. Cleanup
    await supabaseREST('fde_profiles', 'DELETE', null, ['user_id=eq.' + testUserId]);
    diag.cleanup = 'done';

    return json(diag);
  }

  // /api/diag/review-test — test pending_profiles table
  if (path === '/api/diag/review-test' && method === 'GET') {
    var diag = {};
    // 1. Check table exists
    var t1 = await supabaseREST('pending_profiles', 'GET', null, ['select=id', 'limit=1']);
    diag.pending_profiles_read = { ok: !t1.error, error: t1.error || null };

    // 2. Test write
    var testUserId = -99999;
    var testBody = { user_id: testUserId, profile_data: { name: '__diag_test__' }, created_at: now() };
    var t2 = await supabaseREST('pending_profiles', 'POST', testBody, ['select=id']);
    diag.pending_profiles_write = { ok: !t2.error, error: t2.error || null, data: t2.data || null };

    // 3. Cleanup test record
    if (!t2.error) {
      var testId = null;
      if (Array.isArray(t2.data)) testId = t2.data[0]?.id;
      else if (t2.data) testId = t2.data.id;
      if (testId) {
        await supabaseREST('pending_profiles', 'DELETE', null, ['id=eq.' + testId]);
        diag.cleanup = 'deleted test record id=' + testId;
      }
    }

    // 4. Check current pending count
    var t3 = await supabaseREST('pending_profiles', 'GET', null, ['select=id']);
    diag.total_pending = (!t3.error && Array.isArray(t3.data)) ? t3.data.length : -1;

    // 5. Check fde_profiles count
    var t4 = await supabaseREST('fde_profiles', 'GET', null, ['select=id']);
    diag.total_profiles = (!t4.error && Array.isArray(t4.data)) ? t4.data.length : -1;

    return json(diag);
  }

  // /api/test-env
  if (path === '/api/test-env' && method === 'GET') {
    return json({ envKeys: Object.keys(env), sbUrlLen: SB_URL.length, sbKeyLen: SB_KEY.length });
  }

  // /api/diag — 诊断 Supabase 连接和表状态
  if (path === '/api/diag' && method === 'GET') {
    var diag = { sb_url: SB_URL, sb_key_prefix: SB_KEY.substring(0, 20) + '...' };

    // Test 1: 检查 users 表是否存在并能否查询
    var t1 = await supabaseREST('users', 'GET', null, ['select=id']);
    diag.test_users_table = {
      ok: !t1.error,
      status: t1.status || (t1.error ? 'error' : 'ok'),
      raw: t1.error || t1.data
    };

    // Test 2: 尝试直接获取所有表 (via PostgREST root)
    try {
      var rootResp = await fetch(SB_URL + '/rest/v1/', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      diag.test_rest_root = { status: rootResp.status, body: await rootResp.text() };
    } catch(e) {
      diag.test_rest_root = { error: e.message };
    }

    return json(diag);
  }

  // ====== Auth endpoints (already working) ======

  // /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    await ensureAdmin();
    var body = await parseBody();
    if (!body.username || !body.password) return json({ error: '用户名和密码不能为空' }, 400);

    var h = hash(body.password);
    var qs = ['select=*', 'username=eq.' + encodeURIComponent(body.username)];
    var r = await supabaseREST('users', 'GET', null, qs.concat('limit=1'));
    if (r.error) {
      var sbMsg = typeof r.error === 'string' ? r.error : JSON.stringify(r.error);
      return json({ error: '查询用户失败 - ' + sbMsg, detail: r.error }, 500);
    }

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
    if (check.error) {
      var sbMsg2 = typeof check.error === 'string' ? check.error : JSON.stringify(check.error);
      return json({ error: '检查用户名失败 - ' + sbMsg2, detail: check.error }, 500);
    }
    if (check.data && check.data.length > 0) return json({ error: '用户名已存在' }, 409);

    // Create user
    var cr = await supabaseREST('users', 'POST', {
      username: body.username,
      password_hash: hash(body.password),
      email: body.email || '',
      role: 'user',
      created_at: now()
    }, ['select=*']);

    if (cr.error) {
      var sbMsg = typeof cr.error === 'string' ? cr.error : JSON.stringify(cr.error);
      return json({ error: '注册失败 - ' + sbMsg, detail: cr.error }, 500);
    }

    var user = Array.isArray(cr.data) ? cr.data[0] : cr.data;
    if (!user || !user.id) return json({ error: '注册失败，未获取到用户信息' }, 500);

    // Create pending profile — FDE card NOT visible until admin approves
    var pfRes = await supabaseREST('pending_profiles', 'POST', {
      user_id: user.id,
      profile_data: {
        name: body.username,
        email: body.email || ''
      },
      created_at: now()
    }, ['select=id']);
    if (pfRes.error) {
      // Pending creation failed — clean up the user to avoid orphan accounts
      await supabaseREST('users', 'DELETE', null, ['id=eq.' + user.id]);
      var pfMsg = typeof pfRes.error === 'string' ? pfRes.error : JSON.stringify(pfRes.error);
      return json({ error: '创建待审核资料失败，注册已回滚 - ' + pfMsg }, 500);
    }

    delete user.password_hash;
    return json({ token: signToken(user), user: user });
  }

  // /api/auth/me
  if (path === '/api/auth/me' && method === 'GET') {
    await ensureAdmin();
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);

    var r = await supabaseREST('users', 'GET', null, ['select=id,username,email,role,created_at', 'id=eq.' + auth.id]);
    if (r.error) return json({ error: '查询失败' }, 500);
    var users = Array.isArray(r.data) ? r.data : [r.data];
    if (users.length === 0) return json({ error: '用户不存在' }, 404);
    return json(users[0]);
  }

  // ====== Auth: change password ======
  // PUT /api/auth/password
  if (path === '/api/auth/password' && method === 'PUT') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    var body = await parseBody();
    // Accept both oldPassword (fed frontend) and currentPassword
    var oldPwd = body.oldPassword || body.currentPassword;
    if (!oldPwd || !body.newPassword) {
      return json({ error: '当前密码和新密码不能为空' }, 400);
    }

    // Verify current password
    var r = await supabaseREST('users', 'GET', null, ['select=password_hash', 'id=eq.' + auth.id]);
    if (r.error) return json({ error: '查询失败' }, 500);
    var users = Array.isArray(r.data) ? r.data : [r.data];
    if (users.length === 0 || users[0].password_hash !== hash(oldPwd)) {
      return json({ error: '当前密码不正确' }, 400);
    }
    // Update password
    var up = await supabaseREST('users', 'PATCH', { password_hash: hash(body.newPassword) }, ['id=eq.' + auth.id]);
    if (up.error) return json({ error: '修改密码失败' }, 500);
    return json({ ok: true });
  }

  // ====== Auth: list users (admin) ======
  // GET /api/auth/users
  if (path === '/api/auth/users' && method === 'GET') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    if (auth.role !== 'admin') return json({ error: '权限不足' }, 403);
    var r = await supabaseREST('users', 'GET', null, ['select=id,username,email,role,created_at', 'order=created_at.desc']);
    if (r.error) return json({ error: '查询失败' }, 500);
    return json(r.data || []);
  }

  // PUT /api/auth/users/:id/role
  if (false) {} // placeholder for path matching below
  var authUserPath = path.match(/^\/api\/auth\/users\/(\d+)\/role$/);
  if (authUserPath && method === 'PUT') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    if (auth.role !== 'admin') return json({ error: '权限不足' }, 403);
    var userId = parseInt(authUserPath[1]);
    var body = await parseBody();
    if (!body.role) return json({ error: 'role is required' }, 400);
    var up = await supabaseREST('users', 'PATCH', { role: body.role }, ['id=eq.' + userId, 'select=id,username,email,role,created_at']);
    if (up.error) return json({ error: '更新角色失败' }, 500);
    var u = Array.isArray(up.data) ? up.data[0] : up.data;
    return json(u);
  }

  // ====== FDE Profiles ======

  // GET /api/fde/cities
  if (path === '/api/fde/cities' && method === 'GET') {
    var r = await supabaseREST('fde_profiles', 'GET', null, ['select=city']);
    if (r.error) return json(r.error, 500);
    var cities = [];
    (r.data || []).forEach(function(p) { if (p.city && cities.indexOf(p.city) < 0) cities.push(p.city); });
    cities.sort();
    return json(cities);
  }

  // GET /api/fde — list profiles
  if (path === '/api/fde' && method === 'GET') {
    var params = url.searchParams;
    var city = params.get('city') || '';
    var qparts = ['select=*', 'order=updated_at.desc'];
    if (city && city !== '全部' && city !== 'all') {
      qparts.push('city=eq.' + encodeURIComponent(city));
    }
    var r = await supabaseREST('fde_profiles', 'GET', null, qparts);
    if (r.error) return json({ error: '查询失败' }, 500);
    var profiles = r.data || [];
    // Enrich with username/role from users table
    if (profiles.length > 0) {
      var userIds = [];
      profiles.forEach(function(p) { if (p.user_id && userIds.indexOf(p.user_id) < 0) userIds.push(p.user_id); });
      if (userIds.length > 0) {
        var uRes = await supabaseREST('users', 'GET', null, ['select=id,username,role', 'id=in.(' + userIds.join(',') + ')']);
        var userMap = {};
        if (!uRes.error && uRes.data) { (Array.isArray(uRes.data) ? uRes.data : [uRes.data]).forEach(function(u) { userMap[u.id] = u; }); }
        profiles = profiles.map(function(p) {
          var um = userMap[p.user_id] || {};
          p.username = um.username || '';
          p.role = um.role || 'user';
          return p;
        });
      }
    }
    return json(profiles);
  }

  // GET /api/fde/my-pending
  if (path === '/api/fde/my-pending' && method === 'GET') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    var r = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'user_id=eq.' + auth.id]);
    if (r.error) return json({ error: '查询失败' }, 500);
    var data = Array.isArray(r.data) ? r.data : [r.data];
    return json(data.length > 0 ? data[0] : null);
  }

  // GET /api/fde/reviews
  if (path === '/api/fde/reviews' && method === 'GET') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    if (auth.role !== 'admin') return json({ error: '权限不足' }, 403);
    var r = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'order=created_at.desc']);
    if (r.error) return json({ error: '查询失败' }, 500);
    var reviews = r.data || [];
    // Enrich with username + current profile
    if (reviews.length > 0) {
      var userIds2 = [];
      reviews.forEach(function(rev) { if (rev.user_id && userIds2.indexOf(rev.user_id) < 0) userIds2.push(rev.user_id); });
      if (userIds2.length > 0) {
        var uRes2 = await supabaseREST('users', 'GET', null, ['select=id,username,role', 'id=in.(' + userIds2.join(',') + ')']);
        var pRes = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=in.(' + userIds2.join(',') + ')']);
        var userMap2 = {};
        if (!uRes2.error && uRes2.data) { (Array.isArray(uRes2.data) ? uRes2.data : [uRes2.data]).forEach(function(u) { userMap2[u.id] = u; }); }
        var profileMap = {};
        if (!pRes.error && pRes.data) { (Array.isArray(pRes.data) ? pRes.data : [pRes.data]).forEach(function(p) { profileMap[p.user_id] = p; }); }
        reviews = reviews.map(function(rev) {
          rev.username = (userMap2[rev.user_id] || {}).username || '';
          rev.role = (userMap2[rev.user_id] || {}).role || 'user';
          rev.current_profile = profileMap[rev.user_id] || null;
          return rev;
        });
      }
    }
    return json({ reviews: reviews, count: reviews.length });
  }

  // POST|PUT /api/fde/reviews/:id/approve
  var approveMatch = path.match(/^\/api\/fde\/reviews\/(\d+)\/approve$/);
  if (approveMatch && (method === 'PUT' || method === 'POST')) {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    if (auth.role !== 'admin') return json({ error: '权限不足' }, 403);
    var reviewId = parseInt(approveMatch[1]);
    var rev = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'id=eq.' + reviewId]);
    if (rev.error) return json({ error: '查询审批记录失败' }, 500);
    var revData = Array.isArray(rev.data) ? rev.data[0] : rev.data;
    if (!revData) return json({ error: '审批记录不存在' }, 404);

    // Get current profile to detect changed files for cleanup
    var oldPr = await supabaseREST('fde_profiles', 'GET', null, ['select=avatar_url,wechat_qr_url', 'user_id=eq.' + revData.user_id]);
    var oldProfile = (!oldPr.error && oldPr.data && oldPr.data.length > 0)
      ? (Array.isArray(oldPr.data) ? oldPr.data[0] : oldPr.data) : {};

    // Apply profile changes — copy pending profile_data into live fde_profiles
    // Strategy: PATCH first; if 0 rows matched (profile row doesn't exist), fall back to POST (INSERT)
    var pd = revData.profile_data || {};
    var cleanPd = {};
    var allowedFields = ['name','title','city','description','work_details','resources_needed','skills','avatar_url','wechat_qr_url','email','phone'];
    allowedFields.forEach(function(k) { if (pd[k] !== undefined) cleanPd[k] = pd[k]; });

    var upPr = await supabaseREST('fde_profiles', 'PATCH', Object.assign({}, cleanPd, { updated_at: now() }), ['user_id=eq.' + revData.user_id, 'select=*']);
    var profileUpdated = false;
    var profile = null;

    if (upPr.error) {
      // PATCH failed — don't delete pending, return error
      return json({ error: '更新资料失败: ' + JSON.stringify(upPr.error) }, 500);
    }

    var patchResults = upPr.data || [];
    if (patchResults.length > 0) {
      // PATCH matched at least 1 row — success
      profile = Array.isArray(patchResults) ? patchResults[0] : patchResults;
      profileUpdated = true;
    } else {
      // PATCH returned 0 rows — fde_profiles row doesn't exist for this user, try INSERT
      var insPr = await supabaseREST('fde_profiles', 'POST', Object.assign({
        user_id: revData.user_id, created_at: now(), updated_at: now()
      }, cleanPd), ['select=*']);
      if (insPr.error) {
        return json({ error: '创建资料失败: ' + JSON.stringify(insPr.error) }, 500);
      }
      var insResults = Array.isArray(insPr.data) ? insPr.data : (insPr.data ? [insPr.data] : []);
      if (insResults.length > 0) {
        profile = insResults[0];
        profileUpdated = true;
      } else {
        return json({ error: '创建资料失败: 数据库返回空结果' }, 500);
      }
    }

    if (!profileUpdated || !profile) {
      return json({ error: '资料更新失败，请重试' }, 500);
    }

    // Cleanup old files if URLs changed
    if (oldProfile.avatar_url && cleanPd.avatar_url && oldProfile.avatar_url !== cleanPd.avatar_url) {
      await deleteFromStorage(oldProfile.avatar_url);
    }
    if (oldProfile.wechat_qr_url && cleanPd.wechat_qr_url && oldProfile.wechat_qr_url !== cleanPd.wechat_qr_url) {
      await deleteFromStorage(oldProfile.wechat_qr_url);
    }

    // Delete pending record (only after successful profile update)
    await supabaseREST('pending_profiles', 'DELETE', null, ['id=eq.' + reviewId]);
    return json({ message: '已通过审核', profile: profile });
  }

  // POST|PUT /api/fde/reviews/:id/reject
  var rejectMatch = path.match(/^\/api\/fde\/reviews\/(\d+)\/reject$/);
  if (rejectMatch && (method === 'PUT' || method === 'POST')) {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    if (auth.role !== 'admin') return json({ error: '权限不足' }, 403);
    var reviewId = parseInt(rejectMatch[1]);
    await supabaseREST('pending_profiles', 'DELETE', null, ['id=eq.' + reviewId]);
    return json({ message: '已驳回审核' });
  }

  // GET/PUT /api/fde/reviews/:id
  var reviewSingle = path.match(/^\/api\/fde\/reviews\/(\d+)$/);
  if (reviewSingle) {
    if (method === 'GET') {
      var auth = getAuth();
      if (!auth) return json({ error: '请先登录' }, 401);
      var reviewId = parseInt(reviewSingle[1]);
      var rev = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'id=eq.' + reviewId]);
      if (rev.error) return json({ error: '查询失败' }, 500);
      var data = Array.isArray(rev.data) ? rev.data[0] : rev.data;
      return json(data || null);
    }
    if (method === 'PUT') {
      var auth = getAuth();
      if (!auth) return json({ error: '请先登录' }, 401);
      var reviewId = parseInt(reviewSingle[1]);
      var body = await parseBody();
      var existing = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'id=eq.' + reviewId]);
      var existingData = Array.isArray(existing.data) ? existing.data[0] : existing.data;
      if (!existingData) return json({ error: '记录不存在' }, 404);
      // Only allow updating if user matches
      if (auth.role !== 'admin' && existingData.user_id !== auth.id) {
        return json({ error: '权限不足' }, 403);
      }
      var up = await supabaseREST('pending_profiles', 'PATCH', { profile_data: Object.assign({}, existingData.profile_data, body) }, ['id=eq.' + reviewId, 'select=*']);
      if (up.error) return json({ error: '更新失败' }, 500);
      var ud = Array.isArray(up.data) ? up.data[0] : up.data;
      return json(ud);
    }
  }

  // GET/PUT /api/fde/:userId
  var fdeUserMatch = path.match(/^\/api\/fde\/(\d+)$/);
  if (fdeUserMatch) {
    var fdeUserId = parseInt(fdeUserMatch[1]);

    if (method === 'GET') {
      var r = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
      if (r.error) return json({ error: '查询失败' }, 500);
      var data = Array.isArray(r.data) ? r.data[0] : r.data;

      // Get user info for enrichment
      var uRes = await supabaseREST('users', 'GET', null, ['select=id,username,role', 'id=eq.' + fdeUserId]);
      var uData = (!uRes.error && uRes.data)
        ? (Array.isArray(uRes.data) ? uRes.data[0] : uRes.data) : null;

      // Get pending info
      var pend = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
      var pendingData = (!pend.error && pend.data && pend.data.length > 0)
        ? (Array.isArray(pend.data) ? pend.data[0] : pend.data) : null;

      if (data) {
        // Already approved — return live profile
        if (uData) { data.username = uData.username || ''; data.role = uData.role || 'user'; }
        data.hasPending = !!pendingData;
        data.reviewed = true;
        return json(data);
      }

      if (pendingData) {
        // Not yet approved — return pending profile_data as a preview
        var preview = Object.assign({}, pendingData.profile_data || {});
        preview.user_id = fdeUserId;
        preview.reviewed = false;
        preview.hasPending = true;
        if (uData) { preview.username = uData.username || ''; preview.role = uData.role || 'user'; }
        return json(preview);
      }

      // No profile at all — return basic user info
      if (uData) {
        return json({ user_id: fdeUserId, name: '', reviewed: false, hasPending: false, username: uData.username, role: uData.role });
      }
      return json(null);
    }

    if (method === 'PUT') {
      var auth = getAuth();
      if (!auth) return json({ error: '请先登录' }, 401);
      if (auth.role !== 'admin' && auth.id !== fdeUserId) {
        return json({ error: '权限不足' }, 403);
      }
      var body = await parseBody();

      // === Admin: directly update fde_profiles (no review needed) ===
      if (auth.role === 'admin') {
        var exists = await supabaseREST('fde_profiles', 'GET', null, ['select=id', 'user_id=eq.' + fdeUserId]);
        var existsData = Array.isArray(exists.data) ? exists.data : (exists.data ? [exists.data] : []);
        if (existsData.length === 0) {
          var createBody = Object.assign({
            user_id: fdeUserId, name: '', email: '', created_at: now(), updated_at: now()
          }, body);
          var cr = await supabaseREST('fde_profiles', 'POST', createBody, ['select=*']);
          if (cr.error) return json({ error: '创建资料失败' }, 500);
          var cd = Array.isArray(cr.data) ? cr.data[0] : cr.data;
          cd.reviewed = true;
          return json(cd);
        }
        var updateBody = Object.assign({ updated_at: now() }, body);
        var up = await supabaseREST('fde_profiles', 'PATCH', updateBody, ['user_id=eq.' + fdeUserId, 'select=*']);
        if (up.error) return json({ error: '更新资料失败' }, 500);
        var ud = Array.isArray(up.data) ? up.data[0] : up.data;
        ud.reviewed = true;
        return json(ud);
      }

      // === Non-admin: always create/update a pending_profiles record ===
      // Step 1: get current profile (used as merge fallback)
      var cur = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
      var currentProfile = (!cur.error && cur.data && cur.data.length > 0)
        ? (Array.isArray(cur.data) ? cur.data[0] : cur.data)
        : {};

      // Step 2: get existing pending review (for merge fallback)
      var existPend = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
      var existingReview = (!existPend.error && existPend.data && existPend.data.length > 0)
        ? (Array.isArray(existPend.data) ? existPend.data[0] : existPend.data)
        : null;

      // Step 3: merge — body value > existing review > current profile > ''
      function mval(key) {
        if (body[key] !== undefined) return body[key];
        if (existingReview && existingReview.profile_data && existingReview.profile_data[key] !== undefined)
          return existingReview.profile_data[key];
        if (currentProfile[key] !== undefined) return currentProfile[key];
        return '';
      }
      var merged = {
        name: mval('name'), title: mval('title'), city: mval('city'),
        description: mval('description'), work_details: mval('work_details'),
        resources_needed: mval('resources_needed'), skills: mval('skills'),
        email: mval('email'), phone: mval('phone'),
        avatar_url: mval('avatar_url'), wechat_qr_url: mval('wechat_qr_url')
      };

      // Step 4: upsert pending_profiles (single record per user)
      if (existingReview) {
        var upRe = await supabaseREST('pending_profiles', 'PATCH', {
          profile_data: merged, created_at: now()
        }, ['user_id=eq.' + fdeUserId, 'select=*']);
        if (upRe.error) return json({ error: '提交审核失败' }, 500);
      } else {
        var crRe = await supabaseREST('pending_profiles', 'POST', {
          user_id: fdeUserId, profile_data: merged, created_at: now()
        }, ['select=*']);
        if (crRe.error) return json({ error: '提交审核失败' }, 500);
      }

      // Step 5: return merged profile with reviewed: false
      var result = Object.assign({}, currentProfile, merged);
      result.reviewed = false;
      result.hasPending = true;
      result.message = '已提交审核，请等待管理员审核';
      var uRes = await supabaseREST('users', 'GET', null, ['select=id,username,role', 'id=eq.' + fdeUserId]);
      if (!uRes.error && uRes.data) {
        var uData = Array.isArray(uRes.data) ? uRes.data[0] : uRes.data;
        if (uData) { result.username = uData.username || ''; result.role = uData.role || 'user'; }
      }
      return json(result);
    }

    if (method === 'DELETE') {
      var auth = getAuth();
      if (!auth) return json({ error: '请先登录' }, 401);
      if (auth.role !== 'admin') return json({ error: '权限不足，仅管理员可删除FDE卡片' }, 403);

      // Prevent admin from deleting themselves
      if (auth.id === fdeUserId) {
        return json({ error: '不能删除自己的账号' }, 400);
      }

      // 1. Read current profile to get file URLs for cleanup
      var cur = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
      var profileData = (!cur.error && cur.data && cur.data.length > 0)
        ? (Array.isArray(cur.data) ? cur.data[0] : cur.data) : null;

      var deletedFiles = [];

      if (profileData) {
        // 2. Delete associated storage files
        if (profileData.avatar_url) { await deleteFromStorage(profileData.avatar_url); deletedFiles.push(profileData.avatar_url); }
        if (profileData.wechat_qr_url) { await deleteFromStorage(profileData.wechat_qr_url); deletedFiles.push(profileData.wechat_qr_url); }

        // 3. Delete fde_profiles row
        var delPr = await supabaseREST('fde_profiles', 'DELETE', null, ['user_id=eq.' + fdeUserId]);
        if (delPr.error) return json({ error: '删除FDE卡片失败: ' + JSON.stringify(delPr.error) }, 500);
      }

      // 4. Delete pending_profiles row (if any)
      await supabaseREST('pending_profiles', 'DELETE', null, ['user_id=eq.' + fdeUserId]);

      // 5. Delete articles authored by this user
      await supabaseREST('articles', 'DELETE', null, ['author_id=eq.' + fdeUserId]);

      // 6. Delete user account
      var delUser = await supabaseREST('users', 'DELETE', null, ['id=eq.' + fdeUserId]);
      if (delUser.error) {
        return json({ error: 'FDE卡片已删除，但删除用户账号失败: ' + JSON.stringify(delUser.error) }, 500);
      }

      return json({ message: '用户及FDE卡片已全部删除', deletedFiles: deletedFiles });
    }
  }

  // POST /api/fde/:userId/avatar
  var avatarMatch = path.match(/^\/api\/fde\/(\d+)\/avatar$/);
  if (avatarMatch && method === 'POST') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    var fdeUserId = parseInt(avatarMatch[1]);
    if (auth.role !== 'admin' && auth.id !== fdeUserId) return json({ error: '权限不足' }, 403);

    var formData;
    try { formData = await request.formData(); } catch(e) { return json({ error: '无效的请求格式，需要 multipart/form-data' }, 400); }
    var file = formData.get('avatar');
    if (!file || typeof file === 'string') return json({ error: '请上传图片' }, 400);

    var arrayBuffer = await file.arrayBuffer();
    var upload = await uploadToStorage(arrayBuffer, file.name, file.type);
    if (upload.error) return json({ error: upload.error }, 400);

    var url = upload.url;

    // Admin: directly set avatar_url on live profile
    if (auth.role === 'admin') {
      // Delete old avatar
      var oldProfile = await supabaseREST('fde_profiles', 'GET', null, ['select=avatar_url', 'user_id=eq.' + fdeUserId]);
      if (!oldProfile.error && oldProfile.data && oldProfile.data.length > 0) {
        var oldData = Array.isArray(oldProfile.data) ? oldProfile.data[0] : oldProfile.data;
        if (oldData.avatar_url) await deleteFromStorage(oldData.avatar_url);
      }
      await supabaseREST('fde_profiles', 'PATCH', { avatar_url: url, updated_at: now() }, ['user_id=eq.' + fdeUserId]);
      return json({ url: url, reviewed: true });
    }

    // Non-admin: submit to pending review
    var cur = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
    var currentProfile = (!cur.error && cur.data && cur.data.length > 0)
      ? (Array.isArray(cur.data) ? cur.data[0] : cur.data) : {};

    var existPend = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
    var existingReview = (!existPend.error && existPend.data && existPend.data.length > 0)
      ? (Array.isArray(existPend.data) ? existPend.data[0] : existPend.data) : null;

    // Build profile_data from existing review or current profile, override avatar_url
    function mval(key) {
      if (existingReview && existingReview.profile_data && existingReview.profile_data[key] !== undefined)
        return existingReview.profile_data[key];
      if (currentProfile[key] !== undefined) return currentProfile[key];
      return '';
    }
    var merged = {
      name: mval('name'), title: mval('title'), city: mval('city'),
      description: mval('description'), work_details: mval('work_details'),
      resources_needed: mval('resources_needed'), skills: mval('skills'),
      email: mval('email'), phone: mval('phone'),
      avatar_url: url, wechat_qr_url: mval('wechat_qr_url')
    };

    if (existingReview) {
      await supabaseREST('pending_profiles', 'PATCH', { profile_data: merged, created_at: now() }, ['user_id=eq.' + fdeUserId]);
    } else {
      await supabaseREST('pending_profiles', 'POST', { user_id: fdeUserId, profile_data: merged, created_at: now() });
    }
    return json({ url: url, reviewed: false, message: '头像已提交审核' });
  }

  // POST /api/fde/:userId/qrcode
  var qrMatch = path.match(/^\/api\/fde\/(\d+)\/qrcode$/);
  if (qrMatch && method === 'POST') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    var fdeUserId = parseInt(qrMatch[1]);
    if (auth.role !== 'admin' && auth.id !== fdeUserId) return json({ error: '权限不足' }, 403);

    var formData;
    try { formData = await request.formData(); } catch(e) { return json({ error: '无效的请求格式，需要 multipart/form-data' }, 400); }
    var file = formData.get('qrcode');
    if (!file || typeof file === 'string') return json({ error: '请上传图片' }, 400);

    var arrayBuffer = await file.arrayBuffer();
    var upload = await uploadToStorage(arrayBuffer, file.name, file.type);
    if (upload.error) return json({ error: upload.error }, 400);

    var url = upload.url;

    // Admin: directly set wechat_qr_url on live profile
    if (auth.role === 'admin') {
      var oldProfile = await supabaseREST('fde_profiles', 'GET', null, ['select=wechat_qr_url', 'user_id=eq.' + fdeUserId]);
      if (!oldProfile.error && oldProfile.data && oldProfile.data.length > 0) {
        var oldData = Array.isArray(oldProfile.data) ? oldProfile.data[0] : oldProfile.data;
        if (oldData.wechat_qr_url) await deleteFromStorage(oldData.wechat_qr_url);
      }
      await supabaseREST('fde_profiles', 'PATCH', { wechat_qr_url: url, updated_at: now() }, ['user_id=eq.' + fdeUserId]);
      return json({ url: url, reviewed: true });
    }

    // Non-admin: submit to pending review
    var cur = await supabaseREST('fde_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
    var currentProfile = (!cur.error && cur.data && cur.data.length > 0)
      ? (Array.isArray(cur.data) ? cur.data[0] : cur.data) : {};

    var existPend = await supabaseREST('pending_profiles', 'GET', null, ['select=*', 'user_id=eq.' + fdeUserId]);
    var existingReview = (!existPend.error && existPend.data && existPend.data.length > 0)
      ? (Array.isArray(existPend.data) ? existPend.data[0] : existPend.data) : null;

    function mval(key) {
      if (existingReview && existingReview.profile_data && existingReview.profile_data[key] !== undefined)
        return existingReview.profile_data[key];
      if (currentProfile[key] !== undefined) return currentProfile[key];
      return '';
    }
    var merged = {
      name: mval('name'), title: mval('title'), city: mval('city'),
      description: mval('description'), work_details: mval('work_details'),
      resources_needed: mval('resources_needed'), skills: mval('skills'),
      email: mval('email'), phone: mval('phone'),
      avatar_url: mval('avatar_url'), wechat_qr_url: url
    };

    if (existingReview) {
      await supabaseREST('pending_profiles', 'PATCH', { profile_data: merged, created_at: now() }, ['user_id=eq.' + fdeUserId]);
    } else {
      await supabaseREST('pending_profiles', 'POST', { user_id: fdeUserId, profile_data: merged, created_at: now() });
    }
    return json({ url: url, reviewed: false, message: '微信二维码已提交审核' });
  }

  // ====== Articles ======

  // GET /api/articles/categories
  if (path === '/api/articles/categories' && method === 'GET') {
    var r = await supabaseREST('articles', 'GET', null, ['select=category']);
    if (r.error) return json({ error: '查询失败' }, 500);
    var cats = [];
    (r.data || []).forEach(function(a) { if (a.category && cats.indexOf(a.category) < 0) cats.push(a.category); });
    cats.sort();
    return json(cats);
  }

  // GET/POST /api/articles
  if (path === '/api/articles' && method === 'GET') {
    var params = url.searchParams;
    var category = params.get('category') || '';
    var page = parseInt(params.get('page')) || 1;
    var limit = parseInt(params.get('limit')) || 12;
    var qparts = ['select=*', 'order=created_at.desc'];
    if (category && category !== '全部') qparts.push('category=eq.' + encodeURIComponent(category));
    // Use Range header for pagination
    var extraHeaders = {};
    var start = (page - 1) * limit;
    var end = start + limit - 1;
    extraHeaders['Range'] = start + '-' + end;
    extraHeaders['Prefer'] = 'count=exact';
    var url = SB_URL + '/rest/v1/articles?' + qparts.join('&');
    var resp = await fetch(url, {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Range': extraHeaders['Range'], 'Prefer': extraHeaders['Prefer'] }
    });
    var total = 0;
    var cr = resp.headers.get('content-range');
    if (cr) { var m2 = cr.match(/\/(\d+)/); if (m2) total = parseInt(m2[1]); }
    var text = await resp.text();
    var articles = [];
    try { articles = JSON.parse(text); } catch(e) {}
    if (!Array.isArray(articles)) articles = [];
    // Enrich with author names
    if (articles.length > 0) {
      var authorIds = [];
      articles.forEach(function(a) { if (a.author_id && authorIds.indexOf(a.author_id) < 0) authorIds.push(a.author_id); });
      if (authorIds.length > 0) {
        var uRes = await supabaseREST('users', 'GET', null, ['select=id,username', 'id=in.(' + authorIds.join(',') + ')']);
        var userMap = {};
        if (!uRes.error && uRes.data) { (Array.isArray(uRes.data) ? uRes.data : [uRes.data]).forEach(function(u) { userMap[u.id] = u; }); }
        articles = articles.map(function(a) { a.author_name = (userMap[a.author_id] || {}).username || '未知'; return a; });
      }
    }
    return json({ articles: articles, total: total, page: page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  }

  if (path === '/api/articles' && method === 'POST') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);
    var body = await parseBody();
    if (!body.title || !body.content) return json({ error: '标题和内容不能为空' }, 400);
    var cr = await supabaseREST('articles', 'POST', {
      author_id: auth.id,
      title: body.title,
      summary: body.summary || '',
      content: body.content,
      category: body.category || '技术分享',
      cover_url: body.cover_url || ''
    }, ['select=*']);
    if (cr.error) return json({ error: '创建文章失败' }, 500);
    var article = Array.isArray(cr.data) ? cr.data[0] : cr.data;
    article.author_name = auth.username;
    return json(article);
  }

  // GET/PUT/DELETE /api/articles/:id
  var articleMatch = path.match(/^\/api\/articles\/(\d+)$/);
  if (articleMatch) {
    var articleId = parseInt(articleMatch[1]);

    if (method === 'GET') {
      var r = await supabaseREST('articles', 'GET', null, ['select=*', 'id=eq.' + articleId]);
      if (r.error) return json({ error: '查询失败' }, 500);
      var data = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!data) return json({ error: '文章不存在' }, 404);
      var uRes = await supabaseREST('users', 'GET', null, ['select=username', 'id=eq.' + (data.author_id || 0)]);
      data.author_name = (!uRes.error && uRes.data && uRes.data.length > 0) ? uRes.data[0].username : '未知';
      return json(data);
    }

    if (method === 'PUT') {
      var auth = getAuth();
      if (!auth) return json({ error: '请先登录' }, 401);
      var body = await parseBody();
      // Verify ownership or admin
      var existing = await supabaseREST('articles', 'GET', null, ['select=author_id', 'id=eq.' + articleId]);
      var existingData = Array.isArray(existing.data) ? existing.data[0] : existing.data;
      if (!existingData) return json({ error: '文章不存在' }, 404);
      if (auth.role !== 'admin' && existingData.author_id !== auth.id) return json({ error: '权限不足' }, 403);
      var updateBody = Object.assign({}, body, { updated_at: now() });
      var up = await supabaseREST('articles', 'PATCH', updateBody, ['id=eq.' + articleId, 'select=*']);
      if (up.error) return json({ error: '更新文章失败' }, 500);
      var ud = Array.isArray(up.data) ? up.data[0] : up.data;
      ud.author_name = auth.username;
      return json(ud);
    }

    if (method === 'DELETE') {
      var auth = getAuth();
      if (!auth) return json({ error: '请先登录' }, 401);
      var existing = await supabaseREST('articles', 'GET', null, ['select=author_id', 'id=eq.' + articleId]);
      var existingData = Array.isArray(existing.data) ? existing.data[0] : existing.data;
      if (!existingData) return json({ error: '文章不存在' }, 404);
      if (auth.role !== 'admin' && existingData.author_id !== auth.id) return json({ error: '权限不足' }, 403);
      await supabaseREST('articles', 'DELETE', null, ['id=eq.' + articleId]);
      return json({ ok: true });
    }
  }

  // POST /api/articles/upload-cover
  if (path === '/api/articles/upload-cover' && method === 'POST') {
    var auth = getAuth();
    if (!auth) return json({ error: '请先登录' }, 401);

    var formData;
    try { formData = await request.formData(); } catch(e) { return json({ error: '无效的请求格式，需要 multipart/form-data' }, 400); }
    var file = formData.get('cover');
    if (!file || typeof file === 'string') return json({ error: '请上传图片' }, 400);

    var arrayBuffer = await file.arrayBuffer();
    var upload = await uploadToStorage(arrayBuffer, file.name, file.type);
    if (upload.error) return json({ error: upload.error }, 400);

    return json({ url: upload.url });
  }

  // For /assets/* — let platform serve static files
  if (path.startsWith('/assets/')) {
    try { return context.next(); } catch(e) {}
  }

  // SPA fallback — must include CSS & JS links so React can render pages like /admin
  if (!path.startsWith('/api/')) {
    var SPA_HTML = '<!DOCTYPE html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>🚀</text></svg>" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <link rel="preconnect" href="https://fonts.googleapis.com" />\n    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n    <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@500;600;700&display=swap" rel="stylesheet" />\n    <title>FDE - 前沿部署工程师</title>\n    <script type="module" crossorigin src="/assets/index-B-KrccSR.js"><\/script>\n    <link rel="stylesheet" crossorigin href="/assets/index-mLBsqG2v.css">\n  </head>\n  <body class="bg-gray-50 min-h-screen">\n    <div id="root"></div>\n  </body>\n</html>';
    return new Response(SPA_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return json({ error: 'Not Found', path: path }, 404);
}
