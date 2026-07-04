/**
 * EdgeOne-compatible in-memory database
 * No filesystem dependencies - all data stored in memory.
 * 
 * NOTE: Data is NOT persistent across cold starts. For production,
 * connect CloudBase (腾讯云开发) or Supabase via the Integration panel.
 */
const bcrypt = require('bcryptjs');

// In-memory database
let data = {
  users: [],
  fde_profiles: [],
  pending_profiles: [],
  articles: [],
  nextId: { users: 1, profiles: 1, articles: 1, reviews: 1 }
};

// Seed default data
function seedDefaults() {
  if (data.users.length === 0) {
    const hash = bcrypt.hashSync('217310Was@', 10);
    const adminUser = {
      id: 1,
      username: 'admin',
      password_hash: hash,
      email: 'admin@fde.com',
      role: 'admin',
      created_at: new Date().toISOString()
    };
    data.users.push(adminUser);
    data.nextId.users = 2;

    const adminProfile = {
      id: 1,
      user_id: 1,
      name: '管理员',
      title: '系统管理员',
      city: '深圳',
      description: 'FDE 平台管理员',
      work_details: '',
      resources_needed: '',
      skills: '',
      avatar_url: '',
      wechat_qr_url: '',
      email: 'admin@fde.com',
      phone: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.fde_profiles.push(adminProfile);
    data.nextId.profiles = 2;

    console.log('[DB] Default admin account created: admin / 217310Was@');
  }
}

// Initialize on module load
seedDefaults();

// ===================== Query Helpers =====================

const db = {
  // Users
  users: {
    findById(id) { return data.users.find(u => u.id === id) || null; },
    findByUsername(username) { return data.users.find(u => u.username === username) || null; },
    ensureUniqueUsername(username) {
      if (!data.users.some(u => u.username === username)) return username;
      let idx = 1;
      while (data.users.some(u => u.username === `${username}_${idx}`)) { idx++; }
      return `${username}_${idx}`;
    },
    findByUsernameOrSuffix(username, password) {
      const prefix = username + '_';
      const candidates = data.users.filter(
        u => u.username === username || u.username.startsWith(prefix)
      );
      for (const u of candidates) {
        if (bcrypt.compareSync(password, u.password_hash)) {
          return u;
        }
      }
      return null;
    },
    findAll() { return data.users.map(({ password_hash, ...u }) => u); },
    create({ username, password, email, role = 'user' }) {
      const hash = bcrypt.hashSync(password, 10);
      const user = {
        id: data.nextId.users++,
        username,
        password_hash: hash,
        email: email || '',
        role,
        created_at: new Date().toISOString()
      };
      data.users.push(user);
      // Auto-create FDE profile
      db.fde_profiles.create({ user_id: user.id, email: email || '' });
      return { id: user.id, username: user.username, email: user.email, role: user.role, created_at: user.created_at };
    },
    verifyPassword(user, password) {
      return bcrypt.compareSync(password, user.password_hash);
    },
    changePassword(id, newPassword) {
      const user = data.users.find(u => u.id === id);
      if (!user) throw new Error('用户不存在');
      user.password_hash = bcrypt.hashSync(newPassword, 10);
    },
    updateEmail(id, email) {
      const user = data.users.find(u => u.id === id);
      if (!user) throw new Error('用户不存在');
      user.email = email;
    },
    updateRole(id, role) {
      const user = data.users.find(u => u.id === id);
      if (user) { user.role = role; }
    },
    delete(id) {
      data.users = data.users.filter(u => u.id !== id);
      data.fde_profiles = data.fde_profiles.filter(p => p.user_id !== id);
      data.pending_profiles = data.pending_profiles.filter(p => p.user_id !== id);
      data.articles = data.articles.filter(a => a.author_id !== id);
    }
  },

  // FDE Profiles
  fde_profiles: {
    findAll({ city } = {}) {
      let profiles = data.fde_profiles.filter(p => p.name && p.name.trim());
      if (city && city !== '全部' && city !== 'all') {
        profiles = profiles.filter(p => p.city === city);
      }
      return profiles
        .map(p => ({
          ...p,
          username: data.users.find(u => u.id === p.user_id)?.username || '',
          role: data.users.find(u => u.id === p.user_id)?.role || 'user',
          hasPending: data.pending_profiles.some(r => r.user_id === p.user_id)
        }))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    },
    findByUserId(userId) {
      const p = data.fde_profiles.find(p => p.user_id === userId);
      if (!p) return null;
      const u = data.users.find(u => u.id === userId);
      return {
        ...p,
        username: u?.username || '',
        role: u?.role || 'user',
        hasPending: data.pending_profiles.some(r => r.user_id === userId)
      };
    },
    getCities() {
      return [...new Set(data.fde_profiles.filter(p => p.city).map(p => p.city))].sort();
    },
    create({ user_id, name, email }) {
      const profile = {
        id: data.nextId.profiles++,
        user_id,
        name: name || '',
        title: '',
        city: '',
        description: '',
        work_details: '',
        resources_needed: '',
        skills: '',
        avatar_url: '',
        wechat_qr_url: '',
        email: email || '',
        phone: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      data.fde_profiles.push(profile);
      return profile;
    },
    update(userId, fields) {
      let profile = data.fde_profiles.find(p => p.user_id === userId);
      if (!profile) {
        profile = this.create({ user_id: userId, name: fields.name || '' });
      }
      Object.keys(fields).forEach(k => {
        if (fields[k] !== undefined && fields[k] !== '') {
          profile[k] = fields[k];
        }
      });
      profile.updated_at = new Date().toISOString();
      return this.findByUserId(userId);
    },
    updateAvatar(userId, url) {
      const p = data.fde_profiles.find(p => p.user_id === userId);
      if (!p) return null;
      p.avatar_url = url;
      p.updated_at = new Date().toISOString();
      return p;
    },
    updateQrCode(userId, url) {
      const p = data.fde_profiles.find(p => p.user_id === userId);
      if (!p) return null;
      p.wechat_qr_url = url;
      p.updated_at = new Date().toISOString();
      return p;
    },
    delete(userId) {
      const idx = data.fde_profiles.findIndex(p => p.user_id === userId);
      if (idx === -1) return false;
      data.fde_profiles.splice(idx, 1);
      return true;
    }
  },

  // Pending FDE Profiles (admin review queue)
  pending_profiles: {
    findAll() {
      return data.pending_profiles
        .map(r => {
          const current = data.fde_profiles.find(p => p.user_id === r.user_id);
          const u = data.users.find(u => u.id === r.user_id);
          return {
            ...r,
            username: u?.username || '',
            role: u?.role || 'user',
            current_profile: current ? {
              name: current.name, title: current.title, city: current.city,
              description: current.description, work_details: current.work_details,
              resources_needed: current.resources_needed,
              skills: current.skills, email: current.email, phone: current.phone,
              avatar_url: current.avatar_url || '', wechat_qr_url: current.wechat_qr_url || ''
            } : null
          };
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    findByUserId(userId) {
      const r = data.pending_profiles.find(p => p.user_id === userId);
      if (!r) return null;
      const current = data.fde_profiles.find(p => p.user_id === userId);
      const u = data.users.find(u => u.id === userId);
      return {
        ...r,
        username: u?.username || '',
        role: u?.role || 'user',
        current_profile: current ? {
          name: current.name, title: current.title, city: current.city,
          description: current.description, work_details: current.work_details,
          resources_needed: current.resources_needed,
          skills: current.skills, email: current.email, phone: current.phone,
          avatar_url: current.avatar_url || '', wechat_qr_url: current.wechat_qr_url || ''
        } : null
      };
    },
    findById(id) {
      return data.pending_profiles.find(r => r.id === id) || null;
    },
    create({ user_id, profile_data }) {
      const existing = data.pending_profiles.find(r => r.user_id === user_id);
      if (existing) {
        existing.profile_data = profile_data;
        existing.created_at = new Date().toISOString();
        return existing;
      }
      const review = {
        id: data.nextId.reviews++,
        user_id,
        profile_data,
        created_at: new Date().toISOString()
      };
      data.pending_profiles.push(review);
      return review;
    },
    approve(id) {
      const review = data.pending_profiles.find(r => r.id === id);
      if (!review) return null;
      const { profile_data } = review;
      const { wechat_qr_url, avatar_url, ...textFields } = profile_data;
      db.fde_profiles.update(review.user_id, textFields);
      if (avatar_url !== undefined) {
        db.fde_profiles.updateAvatar(review.user_id, avatar_url);
      }
      if (wechat_qr_url !== undefined) {
        db.fde_profiles.updateQrCode(review.user_id, wechat_qr_url);
      }
      data.pending_profiles = data.pending_profiles.filter(r => r.id !== id);
      return db.fde_profiles.findByUserId(review.user_id);
    },
    reject(id) {
      const review = data.pending_profiles.find(r => r.id === id);
      if (!review) return null;
      data.pending_profiles = data.pending_profiles.filter(r => r.id !== id);
      return true;
    },
    update(id, profile_data) {
      const review = data.pending_profiles.find(r => r.id === id);
      if (!review) return null;
      Object.keys(profile_data).forEach(k => {
        if (profile_data[k] !== undefined) {
          review.profile_data[k] = profile_data[k];
        }
      });
      review.created_at = new Date().toISOString();
      return review;
    },
    count() {
      return data.pending_profiles.length;
    }
  },

  // Articles
  articles: {
    findAll({ category, page = 1, limit = 12 } = {}) {
      let articles = data.articles;
      if (category && category !== '全部') {
        articles = articles.filter(a => a.category === category);
      }
      articles = articles
        .map(a => ({ ...a, author_name: data.users.find(u => u.id === a.author_id)?.username || '未知' }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      const total = articles.length;
      const start = (page - 1) * limit;
      const paged = articles.slice(start, start + limit);
      return { articles: paged, total, page, totalPages: Math.ceil(total / limit) };
    },
    findById(id) {
      const a = data.articles.find(a => a.id === id);
      if (!a) return null;
      return { ...a, author_name: data.users.find(u => u.id === a.author_id)?.username || '未知' };
    },
    getCategories() {
      return [...new Set(data.articles.filter(a => a.category).map(a => a.category))].sort();
    },
    create({ author_id, title, summary, content, category }) {
      const article = {
        id: data.nextId.articles++,
        author_id,
        title,
        summary: summary || '',
        content,
        category: category || '技术分享',
        cover_url: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      data.articles.push(article);
      return this.findById(article.id);
    },
    update(id, fields) {
      const a = data.articles.find(a => a.id === id);
      if (!a) return null;
      Object.keys(fields).forEach(k => {
        if (fields[k] !== undefined && fields[k] !== '') {
          a[k] = fields[k];
        }
      });
      a.updated_at = new Date().toISOString();
      return this.findById(id);
    },
    delete(id) {
      data.articles = data.articles.filter(a => a.id !== id);
    }
  }
};

// Admin: Reset Data
function resetToAdmin() {
  const adminUser = data.users.find(u => u.role === 'admin');
  const adminProfile = adminUser
    ? data.fde_profiles.find(p => p.user_id === adminUser.id)
    : null;

  data.users = adminUser
    ? [{ ...adminUser, id: 1 }]
    : [];
  data.fde_profiles = adminProfile
    ? [{ ...adminProfile, id: 1, user_id: 1 }]
    : [];
  data.pending_profiles = [];
  data.articles = [];
  data.nextId = { users: 2, profiles: 2, articles: 1, reviews: 1 };
  return true;
}
db.resetToAdmin = resetToAdmin;

module.exports = db;
