/**
 * EdgeOne Pages Edge Function - Catch-all Handler
 *
 * Handles ALL routes:
 * - /api/*  → API logic (JSON responses)
 * - /*     → SPA fallback (serves index.html)
 *
 * IMPORTANT: All require() calls are lazy-loaded inside onRequest().
 * EdgeOne crashes with HTML fallback if any top-level require() throws
 * (e.g. missing Supabase env vars or incompatible npm modules).
 */

// Lazy-loaded module cache (populated on first successful request)
let _db = null;
let _auth = null;

function getDb() {
  if (!_db) _db = require('../lib/db');
  return _db;
}

function getAuth() {
  if (!_auth) _auth = require('../lib/auth');
  return _auth;
}

// ===================== Helpers =====================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

function getQueryParams(url) {
  const fullUrl = url.startsWith('http') ? url : `http://localhost${url}`;
  const parsed = new URL(fullUrl);
  const params = {};
  parsed.searchParams.forEach((v, k) => { params[k] = v; });
  return params;
}

async function parseBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try { return await request.json(); } catch (e) { return {}; }
  }
  if (contentType.includes('multipart/form-data')) {
    try {
      const formData = await request.formData();
      const body = {};
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          const buffer = await value.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          body[key] = `data:${value.type};base64,${base64}`;
        } else {
          body[key] = value;
        }
      }
      return body;
    } catch (e) { return {}; }
  }
  return {};
}

// ===================== SPA Fallback =====================

function serveSPA() {
  return new Response(SPA_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ===================== Route Handlers =====================

// --- Auth Routes ---

async function handleAuthRegister(request) {
  const body = await parseBody(request);
  const { username, password, email } = body;
  if (!username || !password) return error('用户名和密码不能为空');
  if (password.length < 6) return error('密码长度至少6位');
  const uniqueName = await getDb().users.ensureUniqueUsername(username);
  const user = await getDb().users.create({ username: uniqueName, password, email: email || '' });
  const token = getAuth().generateToken({ id: user.id, username: user.username, role: user.role });
  return json({ token, user }, 201);
}

async function handleAuthLogin(request) {
  const body = await parseBody(request);
  const { username, password } = body;
  if (!username || !password) return error('用户名和密码不能为空');
  const user = await getDb().users.findByUsernameOrSuffix(username, password);
  if (!user) return error('用户名或密码错误', 401);
  const token = getAuth().generateToken({ id: user.id, username: user.username, role: user.role });
  return json({ token, user: { id: user.id, username: user.username, role: user.role, email: user.email } });
}

async function handleAuthMe(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const user = await getDb().users.findById(auth.user.id);
  if (!user) return error('用户不存在', 404);
  const { password_hash, ...safe } = user;
  const profile = await getDb().fde_profiles.findByUserId(auth.user.id);
  if (profile) { safe.avatar_url = profile.avatar_url || ''; safe.name = profile.name || ''; }
  return json(safe);
}

async function handleAuthPassword(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const body = await parseBody(request);
  const { oldPassword, newPassword } = body;
  const user = await getDb().users.findById(auth.user.id);
  if (!getDb().users.verifyPassword(user, oldPassword)) return error('原密码错误');
  await getDb().users.changePassword(auth.user.id, newPassword);
  return json({ message: '密码修改成功' });
}

async function handleAuthUsers(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  return json(await getDb().users.findAll());
}

async function handleAuthReset(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  await getDb().resetToAdmin();
  return json({ message: '数据已重置，仅保留管理员账户' });
}

async function handleAuthUserRole(request, userId) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  const body = await parseBody(request);
  const { role } = body;
  if (!['user', 'admin'].includes(role)) return error('无效的角色');
  await getDb().users.updateRole(userId, role);
  return json({ message: '角色更新成功' });
}

// --- FDE Routes ---

async function handleFdeList(request) {
  const { city } = getQueryParams(request.url);
  return json(await getDb().fde_profiles.findAll({ city }));
}

async function handleFdeCities() {
  return json(await getDb().fde_profiles.getCities());
}

async function handleFdeMyPending(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const review = await getDb().pending_profiles.findByUserId(auth.user.id);
  return json({ hasPending: !!review, review: review || null });
}

async function handleFdeReviews(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  const reviews = await getDb().pending_profiles.findAll();
  return json({ reviews, count: reviews.length });
}

async function handleFdeReviewApprove(request, reviewId) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  const approved = await getDb().pending_profiles.approve(reviewId);
  if (!approved) return error('审核记录不存在', 404);
  return json({ message: '已通过审核', profile: approved });
}

async function handleFdeReviewReject(request, reviewId) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  const rejected = await getDb().pending_profiles.reject(reviewId);
  if (!rejected) return error('审核记录不存在', 404);
  return json({ message: '已驳回审核' });
}

async function handleFdeReviewUpdate(request, reviewId) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const adminCheck = getAuth().adminRequired(auth.user);
  if (adminCheck.error) return error(adminCheck.error, adminCheck.status);
  const review = await getDb().pending_profiles.findById(reviewId);
  if (!review) return error('审核记录不存在', 404);
  const body = await parseBody(request);
  const { name, title, city, description, work_details, resources_needed, skills, email, phone, avatar_url, wechat_qr_url } = body;
  const updated = await db.pending_profiles.update(reviewId, { name, title, city, description, work_details, resources_needed, skills, email, phone, avatar_url, wechat_qr_url });
  return json(updated);
}

async function handleFdeGetProfile(userId) {
  if (isNaN(userId)) return error('FDE 信息不存在', 404);
  const profile = await getDb().fde_profiles.findByUserId(userId);
  if (!profile) return error('FDE 信息不存在', 404);
  return json(profile);
}

async function handleFdeUpdateProfile(request, userId) {
  if (isNaN(userId)) return error('无效的用户ID');
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  if (auth.user.role !== 'admin' && auth.user.id !== userId) return error('只能修改自己的信息', 403);
  const body = await parseBody(request);
  const { name, title, city, description, work_details, resources_needed, skills, email, phone, wechat_qr_url } = body;
  const fields = { name, title, city, description, work_details, resources_needed, skills, email, phone };
  if (auth.user.role === 'admin') {
    const updated = await getDb().fde_profiles.update(userId, fields);
    if (!updated) return error('FDE 信息不存在', 404);
    if (wechat_qr_url !== undefined && (wechat_qr_url === '' || wechat_qr_url === null)) {
      await getDb().fde_profiles.updateQrCode(userId, '');
    }
    return json({ ...(await getDb().fde_profiles.findByUserId(userId)), reviewed: true });
  }
  // Non-admin: save to pending
  const current = await getDb().fde_profiles.findByUserId(userId);
  const existingReview = await getDb().pending_profiles.findByUserId(userId);
  const merged = {
    name: name !== undefined ? name : (existingReview?.profile_data?.name ?? current?.name ?? ''),
    title: title !== undefined ? title : (existingReview?.profile_data?.title ?? current?.title ?? ''),
    city: city !== undefined ? city : (existingReview?.profile_data?.city ?? current?.city ?? ''),
    description: description !== undefined ? description : (existingReview?.profile_data?.description ?? current?.description ?? ''),
    work_details: work_details !== undefined ? work_details : (existingReview?.profile_data?.work_details ?? current?.work_details ?? ''),
    resources_needed: resources_needed !== undefined ? resources_needed : (existingReview?.profile_data?.resources_needed ?? current?.resources_needed ?? ''),
    skills: skills !== undefined ? skills : (existingReview?.profile_data?.skills ?? current?.skills ?? ''),
    email: email !== undefined ? email : (existingReview?.profile_data?.email ?? current?.email ?? ''),
    phone: phone !== undefined ? phone : (existingReview?.profile_data?.phone ?? current?.phone ?? ''),
    wechat_qr_url: wechat_qr_url !== undefined ? (wechat_qr_url || '') : (existingReview?.profile_data?.wechat_qr_url ?? current?.wechat_qr_url ?? '')
  };
  await getDb().pending_profiles.create({ user_id: userId, profile_data: merged });
  const profile = await getDb().fde_profiles.findByUserId(userId);
  return json({ ...profile, reviewed: false, message: '已提交审核，请等待管理员审核' });
}

async function handleFdeDeleteProfile(request, userId) {
  if (isNaN(userId)) return error('无效的用户ID');
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  if (auth.user.role !== 'admin') return error('仅管理员可删除 FDE 信息', 403);
  const deleted = await getDb().fde_profiles.delete(userId);
  if (!deleted) return error('FDE 信息不存在', 404);
  return json({ success: true, message: '已删除' });
}

async function handleFdeUploadAvatar(request, userId) {
  if (isNaN(userId)) return error('无效的用户ID');
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  if (auth.user.role !== 'admin' && auth.user.id !== userId) return error('只能修改自己的头像', 403);
  const body = await parseBody(request);
  const avatarData = body.avatar;
  if (!avatarData) return error('请上传图片');
  if (auth.user.role === 'admin') {
    await getDb().fde_profiles.updateAvatar(userId, avatarData);
    return json({ url: avatarData, reviewed: true });
  }
  const current = await getDb().fde_profiles.findByUserId(userId);
  const existingReview = await getDb().pending_profiles.findByUserId(userId);
  const profile_data = existingReview?.profile_data || {
    name: current?.name || '', title: current?.title || '', city: current?.city || '',
    description: current?.description || '', work_details: current?.work_details || '',
    resources_needed: current?.resources_needed || '',
    skills: current?.skills || '', email: current?.email || '', phone: current?.phone || '',
    wechat_qr_url: current?.wechat_qr_url || ''
  };
  profile_data.avatar_url = avatarData;
  await getDb().pending_profiles.create({ user_id: userId, profile_data });
  return json({ url: avatarData, reviewed: false, message: '头像已提交审核' });
}

async function handleFdeUploadQrCode(request, userId) {
  if (isNaN(userId)) return error('无效的用户ID');
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  if (auth.user.role !== 'admin' && auth.user.id !== userId) return error('只能修改自己的二维码', 403);
  const body = await parseBody(request);
  const qrData = body.qrcode;
  if (!qrData) return error('请上传图片');
  if (auth.user.role === 'admin') {
    await getDb().fde_profiles.updateQrCode(userId, qrData);
    return json({ url: qrData, reviewed: true });
  }
  const current = await getDb().fde_profiles.findByUserId(userId);
  const existingReview = await getDb().pending_profiles.findByUserId(userId);
  const profile_data = existingReview?.profile_data || {
    name: current?.name || '', title: current?.title || '', city: current?.city || '',
    description: current?.description || '', work_details: current?.work_details || '',
    resources_needed: current?.resources_needed || '',
    skills: current?.skills || '', email: current?.email || '', phone: current?.phone || '',
    avatar_url: current?.avatar_url || ''
  };
  profile_data.wechat_qr_url = qrData;
  await getDb().pending_profiles.create({ user_id: userId, profile_data });
  return json({ url: qrData, reviewed: false, message: '二维码已提交审核' });
}

// --- Articles Routes ---

async function handleArticlesList(request) {
  const { category, page, limit } = getQueryParams(request.url);
  return json(await getDb().articles.findAll({ category, page: parseInt(page) || 1, limit: parseInt(limit) || 12 }));
}

async function handleArticlesCategories() {
  return json(await getDb().articles.getCategories());
}

async function handleArticleGet(id) {
  const article = await getDb().articles.findById(id);
  if (!article) return error('文章不存在', 404);
  return json(article);
}

async function handleArticleCreate(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const body = await parseBody(request);
  const { title, summary, content, category } = body;
  if (!title || !content) return error('标题和内容不能为空');
  const article = await getDb().articles.create({ author_id: auth.user.id, title, summary, content, category });
  return json(article, 201);
}

async function handleArticleUpdate(request, id) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const article = await getDb().articles.findById(id);
  if (!article) return error('文章不存在', 404);
  if (auth.user.role !== 'admin' && auth.user.id !== article.author_id) return error('只能修改自己的文章', 403);
  const body = await parseBody(request);
  const { title, summary, content, category } = body;
  const updated = await getDb().articles.update(id, { title, summary, content, category });
  return json(updated);
}

async function handleArticleDelete(request, id) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const article = await getDb().articles.findById(id);
  if (!article) return error('文章不存在', 404);
  if (auth.user.role !== 'admin' && auth.user.id !== article.author_id) return error('只能删除自己的文章', 403);
  await getDb().articles.delete(id);
  return json({ message: '文章已删除' });
}

async function handleArticleUploadCover(request) {
  const auth = getAuth().authRequired(request);
  if (auth.error) return error(auth.error, auth.status);
  const body = await parseBody(request);
  const coverData = body.cover;
  if (!coverData) return error('请上传图片');
  return json({ url: coverData });
}

// ===================== API Router =====================

async function handleAPI(path, method, request) {
  // Health
  if (path === '/api/health' && method === 'GET') {
    return json({ status: 'ok', timestamp: new Date().toISOString() });
  }

  // Auth
  if (path === '/api/auth/register' && method === 'POST') return await handleAuthRegister(request);
  if (path === '/api/auth/login' && method === 'POST') return await handleAuthLogin(request);
  if (path === '/api/auth/me' && method === 'GET') return await handleAuthMe(request);
  if (path === '/api/auth/password' && method === 'PUT') return await handleAuthPassword(request);
  if (path === '/api/auth/users' && method === 'GET') return await handleAuthUsers(request);
  if (path === '/api/auth/reset' && method === 'POST') return await handleAuthReset(request);

  const authUserRoleMatch = path.match(/^\/api\/auth\/users\/(\d+)\/role$/);
  if (authUserRoleMatch && method === 'PUT') return await handleAuthUserRole(request, parseInt(authUserRoleMatch[1]));

  // FDE
  if (path === '/api/fde' && method === 'GET') return await handleFdeList(request);
  if (path === '/api/fde/cities' && method === 'GET') return await handleFdeCities();
  if (path === '/api/fde/my-pending' && method === 'GET') return await handleFdeMyPending(request);
  if (path === '/api/fde/reviews' && method === 'GET') return await handleFdeReviews(request);

  const reviewApproveMatch = path.match(/^\/api\/fde\/reviews\/(\d+)\/approve$/);
  if (reviewApproveMatch && method === 'POST') return await handleFdeReviewApprove(request, parseInt(reviewApproveMatch[1]));
  const reviewRejectMatch = path.match(/^\/api\/fde\/reviews\/(\d+)\/reject$/);
  if (reviewRejectMatch && method === 'POST') return await handleFdeReviewReject(request, parseInt(reviewRejectMatch[1]));
  const reviewUpdateMatch = path.match(/^\/api\/fde\/reviews\/(\d+)$/);
  if (reviewUpdateMatch && method === 'PUT') return await handleFdeReviewUpdate(request, parseInt(reviewUpdateMatch[1]));

  const fdeGetMatch = path.match(/^\/api\/fde\/(\d+)$/);
  if (fdeGetMatch && method === 'GET') return await handleFdeGetProfile(parseInt(fdeGetMatch[1]));
  if (fdeGetMatch && method === 'PUT') return await handleFdeUpdateProfile(request, parseInt(fdeGetMatch[1]));
  if (fdeGetMatch && method === 'DELETE') return await handleFdeDeleteProfile(request, parseInt(fdeGetMatch[1]));

  const fdeAvatarMatch = path.match(/^\/api\/fde\/(\d+)\/avatar$/);
  if (fdeAvatarMatch && method === 'POST') return await handleFdeUploadAvatar(request, parseInt(fdeAvatarMatch[1]));
  const fdeQrMatch = path.match(/^\/api\/fde\/(\d+)\/qrcode$/);
  if (fdeQrMatch && method === 'POST') return await handleFdeUploadQrCode(request, parseInt(fdeQrMatch[1]));

  // Articles
  if (path === '/api/articles' && method === 'GET') return await handleArticlesList(request);
  if (path === '/api/articles/categories' && method === 'GET') return await handleArticlesCategories();
  if (path === '/api/articles/upload-cover' && method === 'POST') return await handleArticleUploadCover(request);
  if (path === '/api/articles' && method === 'POST') return await handleArticleCreate(request);

  const articleGetMatch = path.match(/^\/api\/articles\/(\d+)$/);
  if (articleGetMatch && method === 'GET') return await handleArticleGet(parseInt(articleGetMatch[1]));
  if (articleGetMatch && method === 'PUT') return await handleArticleUpdate(request, parseInt(articleGetMatch[1]));
  if (articleGetMatch && method === 'DELETE') return await handleArticleDelete(request, parseInt(articleGetMatch[1]));

  return error('Not Found', 404);
}

// ===================== SPA HTML (inline) =====================
// NOTE: When the frontend is rebuilt, update this HTML by copying
// the content of the built index.html from the frontend's dist/ directory.

const SPA_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚀</text></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@500;600;700&display=swap" rel="stylesheet" />
    <title>FDE - 前沿部署工程师</title>
    <script type="module" crossorigin src="/assets/index-B-KrccSR.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-mLBsqG2v.css">
  </head>
  <body class="bg-gray-50 min-h-screen">
    <div id="root"></div>
  </body>
</html>`;

// ===================== Main Entry Point =====================

async function onRequest(context) {
  try {
    const { request } = context;
    const urlStr = request.url;
    // EdgeOne may provide relative URLs; ensure we have a valid absolute URL
    const url = new URL(urlStr.startsWith('http') ? urlStr : 'http://localhost' + urlStr);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // CORS preflight (before any DB work)
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

    // Ensure admin account exists (non-fatal: log error but don't crash the request)
    try {
      await getDb().ensureDefaults();
    } catch (seedErr) {
      console.error('[Init] ensureDefaults failed (non-fatal):', seedErr.message);
    }

    // API routes
    if (path.startsWith('/api/')) {
      try {
        return await handleAPI(path, method, request);
      } catch (err) {
        console.error('[API Error]', err.message, err.stack || '');
        return json({ error: '服务器内部错误: ' + err.message, detail: err.stack || '' }, 500);
      }
    }

    // SPA fallback: serve index.html for all non-API, non-asset routes
    // EdgeOne serves exact static file matches (/assets/*) automatically before edge functions
    return serveSPA();
  } catch (fatalErr) {
    // Absolute last resort — should NEVER return HTML
    console.error('[Fatal]', fatalErr.message, fatalErr.stack || '');
    return json({ error: '服务器启动失败: ' + fatalErr.message, detail: fatalErr.stack || '' }, 500);
  }
}

module.exports = { onRequest };
