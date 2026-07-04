/**
 * Supabase-backed database layer
 * 
 * All data persisted in Supabase PostgreSQL. No cold-start data loss.
 * API surface remains identical to the original in-memory db.js.
 */

const bcrypt = require('bcryptjs');
const { getClient } = require('./supabase');

// ===================== Initialization =====================

let initialized = false;

/**
 * Seed default admin account if not exists.
 * Idempotent — safe to call on every request.
 */
async function ensureDefaults() {
  if (initialized) return;
  try {
    const client = getClient();
    const { data: admins } = await client
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .limit(1);

    if (!admins || admins.length === 0) {
      const hash = bcrypt.hashSync('217310Was@', 10);
      const { data: [admin], error: uErr } = await client
        .from('users')
        .insert({
          username: 'admin',
          password_hash: hash,
          email: 'admin@fde.com',
          role: 'admin'
        })
        .select();

      if (uErr) {
        console.error('[DB] Failed to seed admin user:', uErr.message);
        initialized = true;
        return;
      }

      if (admin) {
        await client.from('fde_profiles').insert({
          user_id: admin.id,
          name: '管理员',
          title: '系统管理员',
          city: '深圳',
          description: 'FDE 平台管理员',
          email: 'admin@fde.com'
        });
      }
      console.log('[DB] Default admin account created: admin / 217310Was@');
    }
  } catch (err) {
    console.error('[DB] Seed error:', err.message);
  }
  initialized = true;
}

// ===================== Database API =====================

const db = {
  /** Ensure admin exists (call once per request / on cold start) */
  ensureDefaults,

  // ===================== Users =====================

  users: {
    async findById(id) {
      const { data } = await getClient().from('users').select('*').eq('id', id).single();
      return data || null;
    },

    async findByUsername(username) {
      const { data } = await getClient().from('users').select('*').eq('username', username).single();
      return data || null;
    },

    async ensureUniqueUsername(username) {
      const { count } = await getClient()
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('username', username);
      if (!count) return username;

      let idx = 1;
      while (true) {
        const candidate = `${username}_${idx}`;
        const { count: c } = await getClient()
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('username', candidate);
        if (!c) return candidate;
        idx++;
      }
    },

    async findByUsernameOrSuffix(username, password) {
      // Exact match
      const { data: exact } = await getClient()
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();

      if (exact && bcrypt.compareSync(password, exact.password_hash)) {
        return exact;
      }

      // Suffix match: username_1, username_2, etc.
      const { data: suffixMatches } = await getClient()
        .from('users')
        .select('*')
        .like('username', `${username}_%`);

      if (suffixMatches) {
        for (const u of suffixMatches) {
          if (bcrypt.compareSync(password, u.password_hash)) {
            return u;
          }
        }
      }

      return null;
    },

    async findAll() {
      const { data } = await getClient()
        .from('users')
        .select('id, username, email, role, created_at')
        .order('created_at', { ascending: false });
      return data || [];
    },

    async create({ username, password, email, role = 'user' }) {
      const client = getClient();
      const hash = bcrypt.hashSync(password, 10);

      const { data: [user], error } = await client
        .from('users')
        .insert({
          username,
          password_hash: hash,
          email: email || '',
          role
        })
        .select();

      if (error) throw error;

      // Auto-create FDE profile
      await db.fde_profiles.create({ user_id: user.id, email: email || '' });

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        created_at: user.created_at
      };
    },

    verifyPassword(user, password) {
      return bcrypt.compareSync(password, user.password_hash);
    },

    async changePassword(id, newPassword) {
      const hash = bcrypt.hashSync(newPassword, 10);
      await getClient().from('users').update({ password_hash: hash }).eq('id', id);
    },

    async updateEmail(id, email) {
      await getClient().from('users').update({ email }).eq('id', id);
    },

    async updateRole(id, role) {
      await getClient().from('users').update({ role }).eq('id', id);
    },

    async delete(id) {
      // CASCADE handles profiles, pending_profiles, articles
      await getClient().from('users').delete().eq('id', id);
    }
  },

  // ===================== FDE Profiles =====================

  fde_profiles: {
    async _enrichProfiles(profiles) {
      if (!profiles || !profiles.length) return [];
      const client = getClient();

      const userIds = [...new Set(profiles.map(p => p.user_id))];

      const [{ data: users }, { data: pending }] = await Promise.all([
        client.from('users').select('id, username, role').in('id', userIds),
        client.from('pending_profiles').select('user_id').in('user_id', userIds)
      ]);

      const userMap = {};
      if (users) users.forEach(u => { userMap[u.id] = u; });

      const pendingSet = new Set((pending || []).map(p => p.user_id));

      return profiles.map(p => ({
        ...p,
        username: userMap[p.user_id]?.username || '',
        role: userMap[p.user_id]?.role || 'user',
        hasPending: pendingSet.has(p.user_id)
      }));
    },

    async findAll({ city } = {}) {
      const client = getClient();
      let query = client.from('fde_profiles').select('*').neq('name', '').not('name', 'is', null);

      if (city && city !== '全部' && city !== 'all') {
        query = query.eq('city', city);
      }

      const { data } = await query.order('updated_at', { ascending: false });
      const enriched = await db.fde_profiles._enrichProfiles(data || []);
      return enriched;
    },

    async findByUserId(userId) {
      const { data: p } = await getClient().from('fde_profiles').select('*').eq('user_id', userId).single();
      if (!p) return null;
      const [enriched] = await db.fde_profiles._enrichProfiles([p]);
      return enriched;
    },

    async getCities() {
      const { data } = await getClient()
        .from('fde_profiles')
        .select('city')
        .neq('city', '')
        .not('city', 'is', null);
      const cities = [...new Set((data || []).map(d => d.city))];
      return cities.sort();
    },

    async create({ user_id, name, email }) {
      const { data: [profile] } = await getClient()
        .from('fde_profiles')
        .insert({
          user_id,
          name: name || '',
          email: email || '',
          title: '',
          city: '',
          description: '',
          work_details: '',
          resources_needed: '',
          skills: '',
          avatar_url: '',
          wechat_qr_url: '',
          phone: ''
        })
        .select();
      return profile;
    },

    async update(userId, fields) {
      const client = getClient();
      // Ensure profile exists
      const { data: existing } = await client.from('fde_profiles').select('id').eq('user_id', userId).single();
      if (!existing) {
        return this.create({ user_id: userId, name: fields.name || '' });
      }

      const updateData = { updated_at: new Date().toISOString() };
      Object.keys(fields).forEach(k => {
        if (fields[k] !== undefined) {
          updateData[k] = fields[k];
        }
      });
      if (Object.keys(updateData).length === 1) return this.findByUserId(userId); // only updated_at

      await client.from('fde_profiles').update(updateData).eq('user_id', userId);
      return this.findByUserId(userId);
    },

    async updateAvatar(userId, url) {
      const client = getClient();
      await client.from('fde_profiles').update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('user_id', userId);
      return this.findByUserId(userId);
    },

    async updateQrCode(userId, url) {
      const client = getClient();
      await client.from('fde_profiles').update({ wechat_qr_url: url, updated_at: new Date().toISOString() }).eq('user_id', userId);
      return this.findByUserId(userId);
    },

    async delete(userId) {
      const { error } = await getClient().from('fde_profiles').delete().eq('user_id', userId);
      return !error;
    }
  },

  // ===================== Pending Profiles =====================

  pending_profiles: {
    async _enrichReviews(reviews) {
      if (!reviews || !reviews.length) return [];
      const client = getClient();
      const userIds = [...new Set(reviews.map(r => r.user_id))];

      const [{ data: users }, { data: profiles }] = await Promise.all([
        client.from('users').select('id, username, role').in('id', userIds),
        client.from('fde_profiles').select('*').in('user_id', userIds)
      ]);

      const userMap = {};
      if (users) users.forEach(u => { userMap[u.id] = u; });

      const profileMap = {};
      if (profiles) profiles.forEach(p => { profileMap[p.user_id] = p; });

      return reviews.map(r => ({
        ...r,
        username: userMap[r.user_id]?.username || '',
        role: userMap[r.user_id]?.role || 'user',
        current_profile: profileMap[r.user_id] ? {
          name: profileMap[r.user_id].name,
          title: profileMap[r.user_id].title,
          city: profileMap[r.user_id].city,
          description: profileMap[r.user_id].description,
          work_details: profileMap[r.user_id].work_details,
          resources_needed: profileMap[r.user_id].resources_needed,
          skills: profileMap[r.user_id].skills,
          email: profileMap[r.user_id].email,
          phone: profileMap[r.user_id].phone,
          avatar_url: profileMap[r.user_id].avatar_url || '',
          wechat_qr_url: profileMap[r.user_id].wechat_qr_url || ''
        } : null
      }));
    },

    async findAll() {
      const { data } = await getClient()
        .from('pending_profiles')
        .select('*')
        .order('created_at', { ascending: false });
      return db.pending_profiles._enrichReviews(data || []);
    },

    async findByUserId(userId) {
      const { data: r } = await getClient()
        .from('pending_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (!r) return null;
      const [enriched] = await db.pending_profiles._enrichReviews([r]);
      return enriched;
    },

    async findById(id) {
      const { data: r } = await getClient()
        .from('pending_profiles')
        .select('*')
        .eq('id', id)
        .single();
      return r || null;
    },

    async create({ user_id, profile_data }) {
      const client = getClient();
      const { data: [review] } = await client
        .from('pending_profiles')
        .upsert({
          user_id,
          profile_data,
          created_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
        .select();
      return review;
    },

    async approve(id) {
      const client = getClient();
      const review = await this.findById(id);
      if (!review) return null;

      const { profile_data } = review;
      const { wechat_qr_url, avatar_url, ...textFields } = profile_data;

      await db.fde_profiles.update(review.user_id, textFields);

      if (avatar_url !== undefined) {
        await db.fde_profiles.updateAvatar(review.user_id, avatar_url);
      }
      if (wechat_qr_url !== undefined) {
        await db.fde_profiles.updateQrCode(review.user_id, wechat_qr_url);
      }

      await client.from('pending_profiles').delete().eq('id', id);
      return db.fde_profiles.findByUserId(review.user_id);
    },

    async reject(id) {
      const { error } = await getClient().from('pending_profiles').delete().eq('id', id);
      if (error) return null;
      return true;
    },

    async update(id, fields) {
      const client = getClient();
      const { data: review } = await client
        .from('pending_profiles')
        .select('*')
        .eq('id', id)
        .single();

      if (!review) return null;

      const updatedData = { ...review.profile_data };
      Object.keys(fields).forEach(k => {
        if (fields[k] !== undefined) {
          updatedData[k] = fields[k];
        }
      });

      const { data: [updated] } = await client
        .from('pending_profiles')
        .update({ profile_data: updatedData, created_at: new Date().toISOString() })
        .eq('id', id)
        .select();

      return updated;
    },

    async count() {
      const { count } = await getClient()
        .from('pending_profiles')
        .select('*', { count: 'exact', head: true });
      return count || 0;
    }
  },

  // ===================== Articles =====================

  articles: {
    async findAll({ category, page = 1, limit = 12 } = {}) {
      const client = getClient();
      let query = client.from('articles').select('*', { count: 'exact' });

      if (category && category !== '全部') {
        query = query.eq('category', category);
      }

      const start = (page - 1) * limit;
      const end = start + limit - 1;

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(start, end);

      if (error) return { articles: [], total: 0, page, totalPages: 0 };

      // Enrich with author names
      const authorIds = [...new Set((data || []).map(a => a.author_id))];
      const { data: users } = await client.from('users').select('id, username').in('id', authorIds);
      const userMap = {};
      if (users) users.forEach(u => { userMap[u.id] = u; });

      const articles = (data || []).map(a => ({
        ...a,
        author_name: userMap[a.author_id]?.username || '未知'
      }));

      return {
        articles,
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      };
    },

    async findById(id) {
      const client = getClient();
      const { data: a } = await client.from('articles').select('*').eq('id', id).single();
      if (!a) return null;

      const { data: [user] } = await client.from('users').select('username').eq('id', a.author_id);
      return { ...a, author_name: user?.username || '未知' };
    },

    async getCategories() {
      const { data } = await getClient()
        .from('articles')
        .select('category')
        .neq('category', '')
        .not('category', 'is', null);
      return [...new Set((data || []).map(d => d.category))].sort();
    },

    async create({ author_id, title, summary, content, category }) {
      const client = getClient();
      const { data: [article], error } = await client
        .from('articles')
        .insert({
          author_id,
          title,
          summary: summary || '',
          content,
          category: category || '技术分享',
          cover_url: ''
        })
        .select();

      if (error) throw error;

      // Enrich with author name
      const { data: [user] } = await client.from('users').select('username').eq('id', author_id);
      return { ...article, author_name: user?.username || '未知' };
    },

    async update(id, fields) {
      const client = getClient();
      const updateData = { updated_at: new Date().toISOString() };
      Object.keys(fields).forEach(k => {
        if (fields[k] !== undefined) {
          updateData[k] = fields[k];
        }
      });
      if (Object.keys(updateData).length === 1) return this.findById(id); // only updated_at

      await client.from('articles').update(updateData).eq('id', id);
      return this.findById(id);
    },

    async delete(id) {
      await getClient().from('articles').delete().eq('id', id);
    }
  }
};

// Reset: remove all non-admin data
async function resetToAdmin() {
  const client = getClient();

  // Find all admin users
  const { data: admins } = await client.from('users').select('id').eq('role', 'admin');
  const adminIds = (admins || []).map(a => a.id);

  if (adminIds.length === 0) return false;

  // Delete non-admin data (order matters due to FK)
  await client.from('articles').delete().not('author_id', 'in', `(${adminIds.join(',')})`);
  await client.from('pending_profiles').delete().not('user_id', 'in', `(${adminIds.join(',')})`);
  await client.from('fde_profiles').delete().not('user_id', 'in', `(${adminIds.join(',')})`);
  await client.from('users').delete().not('id', 'in', `(${adminIds.join(',')})`);

  // Reset admin profile
  for (const id of adminIds) {
    await client.from('fde_profiles').update({
      name: '管理员',
      title: '系统管理员',
      city: '深圳',
      description: 'FDE 平台管理员',
      work_details: '',
      resources_needed: '',
      skills: '',
      avatar_url: '',
      wechat_qr_url: '',
      phone: '',
      updated_at: new Date().toISOString()
    }).eq('user_id', id);
  }

  return true;
}
db.resetToAdmin = resetToAdmin;

module.exports = db;
