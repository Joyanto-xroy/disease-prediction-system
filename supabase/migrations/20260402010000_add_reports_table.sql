-- ============================================================
-- ADD REPORTS TABLE
-- Run this in Supabase SQL Editor if you used SETUP_RUN_THIS_ONCE.sql
-- Or it will be applied automatically via Supabase migrations.
-- ============================================================

-- 1. Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  report_type text NOT NULL DEFAULT 'consultation',
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS "Authenticated can select reports" ON reports;
CREATE POLICY "Authenticated can select reports"
  ON reports FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert reports" ON reports;
CREATE POLICY "Authenticated can insert reports"
  ON reports FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update reports" ON reports;
CREATE POLICY "Authenticated can update reports"
  ON reports FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can delete reports" ON reports;
CREATE POLICY "Authenticated can delete reports"
  ON reports FOR DELETE TO authenticated USING (true);

-- 4. updated_at trigger
DROP TRIGGER IF EXISTS update_reports_updated_at ON reports;
CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON reports FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
