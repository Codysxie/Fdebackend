-- ============================================================
-- FDE Platform - Supabase Database Schema
-- 请在 Supabase 控制台 → SQL Editor 中执行此脚本
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT DEFAULT '',
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FDE 资料表
CREATE TABLE IF NOT EXISTS fde_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT DEFAULT '',
  title TEXT DEFAULT '',
  city TEXT DEFAULT '',
  description TEXT DEFAULT '',
  work_details TEXT DEFAULT '',
  resources_needed TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  wechat_qr_url TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 待审核 FDE 资料表
CREATE TABLE IF NOT EXISTS pending_profiles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  profile_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 文章表
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  category TEXT DEFAULT '技术分享',
  cover_url TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_fde_profiles_user_id ON fde_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_fde_profiles_city ON fde_profiles(city);
CREATE INDEX IF NOT EXISTS idx_pending_profiles_user_id ON pending_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_articles_author_id ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at DESC);

-- 启用 RLS（Row Level Security）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fde_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

-- RLS 策略：允许服务端（使用 anon key）完全访问所有表
-- 因为 EdgeOne Edge Function 在后端运行，使用 service_role 或 anon key 直接操作
CREATE POLICY "Allow all access via backend" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access via backend" ON fde_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access via backend" ON pending_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access via backend" ON articles FOR ALL USING (true) WITH CHECK (true);

-- 授予 anon 角色表级权限（RLS 策略只过滤行，表级权限需要单独授予）
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON fde_profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON pending_profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON articles TO anon, authenticated;

-- 授予序列使用权限（SERIAL 主键需要）
GRANT USAGE ON SEQUENCE users_id_seq TO anon, authenticated;
GRANT USAGE ON SEQUENCE fde_profiles_id_seq TO anon, authenticated;
GRANT USAGE ON SEQUENCE pending_profiles_id_seq TO anon, authenticated;
GRANT USAGE ON SEQUENCE articles_id_seq TO anon, authenticated;

-- ============================================================
-- Supabase Storage — 文件上传 bucket（手动创建或由边缘函数自动创建）
-- 在 Supabase 控制台 → Storage → New Bucket 创建：
--   Name: fde-uploads
--   Public bucket: ✓ (勾选)
--   File size limit: 5MB
--   Allowed MIME types: image/png, image/jpeg, image/gif, image/webp
-- ============================================================

-- Storage 权限策略（在 Supabase 控制台 → Storage → Policies 中创建）：
-- 1. fde-uploads bucket → Policy: "Allow all"
--    Allowed operations: SELECT, INSERT, UPDATE, DELETE
--    Policy definition: true (允许所有操作，因为 edge function 在后端运行)
--
-- 或执行以下 SQL（如果 Storage SQL 可用）：
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('fde-uploads', 'fde-uploads', true, 5242880,
--         ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
-- ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "Allow all access via backend" ON storage.objects
--   FOR ALL USING (true) WITH CHECK (true);
