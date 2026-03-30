-- S.O.S. (Service Operations System) Database Schema

-- JOB CARDS
CREATE TABLE IF NOT EXISTS job_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    technician_id TEXT NOT NULL,
    technician_name TEXT NOT NULL,
    facility TEXT NOT NULL,
    machine_model TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    fault_description TEXT NOT NULL,
    work_performed TEXT,
    parts_used TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'draft')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PARTS REQUISITION
CREATE TABLE IF NOT EXISTS parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by TEXT NOT NULL,
    technician_name TEXT NOT NULL,
    part_name TEXT NOT NULL,
    urgency TEXT DEFAULT 'NORMAL' CHECK (urgency IN ('NORMAL', 'URGENT', 'CRITICAL')),
    quantity INTEGER DEFAULT 1,
    notes TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'RECEIVED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    detail TEXT,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PERFORMANCE METRICS
CREATE TABLE IF NOT EXISTS performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    technician_id TEXT NOT NULL,
    technician_name TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    jobs_completed INTEGER DEFAULT 0,
    jobs_total INTEGER DEFAULT 0,
    avg_resolution_hrs DECIMAL(10, 2),
    sla_percentage DECIMAL(5, 2),
    travel_hrs DECIMAL(10, 2),
    parts_requested INTEGER DEFAULT 0,
    parts_received INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (technician_id, period_start, period_end)
);

-- ANNOUNCEMENTS
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_title TEXT,
    message TEXT NOT NULL,
    criticality TEXT DEFAULT 'news' CHECK (criticality IN ('news', 'urgent', 'critical')),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE job_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Note: Policies will be refined once auth roles are clarified. 
-- For initial development, we'll allow all authenticated users to read/write.
-- (The supabase.js implementation uses the anon key, so we'll start with public access for development speed if requested, 
-- but proper RLS usually requires auth.uid()).

-- Authenticated role policies
CREATE POLICY "Allow authenticated full access to job_cards"    ON job_cards    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access to parts"         ON parts         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access to logs"          ON logs          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access to performance"   ON performance   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated full access to announcements" ON announcements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon role policies (required for apps using the anon key directly)
CREATE POLICY "Allow anon access to job_cards"    ON job_cards    FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon access to parts"         ON parts         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon access to logs"          ON logs          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon access to performance"   ON performance   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon access to announcements" ON announcements FOR ALL TO anon USING (true) WITH CHECK (true);

-- USERS TABLE (needed for login)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    full_name TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'technician' CHECK (role IN ('technician', 'admin')),
    title TEXT,
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon access to users"          ON users         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to users" ON users         FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- THREADS (Discussion / Collaboration Hub)
CREATE TABLE IF NOT EXISTS threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('fault_finding', 'parts_advice', 'software_issues', 'installation_support')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    urgency TEXT DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent', 'resolved')),
    reply_count INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    attachment_urls TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon access to threads"          ON threads FOR ALL TO anon         USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to threads" ON threads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- SCHEMA ADDITIONS (run these if tables already exist)
-- ============================================================
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS signature_data TEXT;

-- KNOWLEDGE BASE (AI Assistant reference material)
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('manual', 'service_bulletin', 'important_date', 'procedure', 'parts_guide')),
    content TEXT NOT NULL,
    tags TEXT,
    effective_date DATE,
    added_by TEXT NOT NULL DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon access to knowledge_base"          ON knowledge_base FOR ALL TO anon         USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated access to knowledge_base" ON knowledge_base FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- SEED DATA — System Users
-- Passwords are SHA-256 hashed with prefix "sos_v1_"
-- ============================================================
-- | Employee  | Username  | Plain Password | Role        |
-- |-----------|-----------|----------------|-------------|
-- | EMP001    | admin     | Admin@2025!    | admin       |
-- | EMP002    | jmokoena  | Tech@2025!     | technician  |
-- | EMP003    | sdlamini  | Tech@2025!     | technician  |
-- | EMP004    | tnkosi    | Tech@2025!     | technician  |
-- ============================================================
INSERT INTO users (employee_id, username, full_name, password, role, title, is_active)
VALUES
  ('EMP001', 'admin',    'Admin User',   '6c19b0942289f00a29398f07c8d5e7607c81a8f543932bd01712f1ac8f1de967', 'admin',      'System Administrator', true),
  ('EMP002', 'jmokoena', 'John Mokoena', '7f836d0e3bb441976e2ee197beb8f85523b9e0ea89e2f3abb258a186a6fc2a12', 'technician', 'Field Technician',     true),
  ('EMP003', 'sdlamini', 'Sara Dlamini', '7f836d0e3bb441976e2ee197beb8f85523b9e0ea89e2f3abb258a186a6fc2a12', 'technician', 'Field Technician',     true),
  ('EMP004', 'tnkosi',   'Thabo Nkosi',  '7f836d0e3bb441976e2ee197beb8f85523b9e0ea89e2f3abb258a186a6fc2a12', 'technician', 'Field Technician',     true)
ON CONFLICT (employee_id) DO NOTHING;
