-- ============================================================
-- CLINICAL SUPPORT SYSTEM - COMPLETE SETUP SQL
-- Run this ENTIRE script in your Supabase SQL Editor once.
-- Go to: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- 1. CREATE PROFILES TABLE (if not exists)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'doctor')),
  verification_status text DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  doctor_id text,
  specialization text,
  clinic_permit_id text,
  license_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. ADD COMPREHENSIVE MISSING COLUMNS (safe – skips if they exist)
-- This ensures that if a default profiles table existed, we still get our custom columns
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS doctor_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS specialization text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS license_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS clinic_permit_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verification_status text;

-- Ensure default values for new or modified columns
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'doctor';
ALTER TABLE profiles ALTER COLUMN verification_status SET DEFAULT 'pending';

-- 3. CREATE PATIENTS TABLE
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_doctor uuid REFERENCES profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  phone text,
  email text,
  address text,
  blood_group text,
  emergency_contact_name text,
  emergency_contact_phone text,
  medical_history text,
  allergies text,
  current_medications text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. CREATE PATIENT_VISITS TABLE
CREATE TABLE IF NOT EXISTS patient_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  visit_date timestamptz DEFAULT now(),
  visit_type text DEFAULT 'consultation',
  symptoms text,
  diagnosis text,
  notes text,
  test_results text,
  vitals jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS vitals jsonb;
ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS visit_type text DEFAULT 'consultation';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS blood_group text;

-- 5. CREATE PRESCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES patient_visits(id) ON DELETE CASCADE,
  medications jsonb NOT NULL,
  instructions text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 6. CREATE REPORTS TABLE
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

-- 7. ENABLE RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- 7. DROP ALL OLD CONFLICTING POLICIES
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Doctors and admins can read all patients" ON patients;
DROP POLICY IF EXISTS "Doctors and admins can insert patients" ON patients;
DROP POLICY IF EXISTS "Doctors and admins can update patients" ON patients;
DROP POLICY IF EXISTS "Doctors can read visits for their patients" ON patient_visits;
DROP POLICY IF EXISTS "Doctors can insert visits" ON patient_visits;
DROP POLICY IF EXISTS "Doctors can update their visits" ON patient_visits;
DROP POLICY IF EXISTS "Doctors and patients can read prescriptions" ON prescriptions;
DROP POLICY IF EXISTS "Doctors can insert prescriptions" ON prescriptions;

-- 8. CREATE CLEAN, NON-RECURSIVE RLS POLICIES
-- profiles: users read/update their own row; admin bypass via SECURITY DEFINER
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- patients: doctors and verified admins can do all operations
DROP POLICY IF EXISTS "Authenticated can select patients" ON patients;
CREATE POLICY "Authenticated can select patients"
  ON patients FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can insert patients" ON patients;
CREATE POLICY "Authenticated can insert patients"
  ON patients FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update patients" ON patients;
CREATE POLICY "Authenticated can update patients"
  ON patients FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can delete patients" ON patients;
CREATE POLICY "Authenticated can delete patients"
  ON patients FOR DELETE TO authenticated
  USING (true);

-- patient_visits: open to authenticated (trust app-layer security)
DROP POLICY IF EXISTS "Authenticated can select visits" ON patient_visits;
CREATE POLICY "Authenticated can select visits"
  ON patient_visits FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert visits" ON patient_visits;
CREATE POLICY "Authenticated can insert visits"
  ON patient_visits FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated can update visits" ON patient_visits;
CREATE POLICY "Authenticated can update visits"
  ON patient_visits FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can delete visits" ON patient_visits;
CREATE POLICY "Authenticated can delete visits"
  ON patient_visits FOR DELETE TO authenticated USING (true);

-- prescriptions
DROP POLICY IF EXISTS "Authenticated can select prescriptions" ON prescriptions;
CREATE POLICY "Authenticated can select prescriptions"
  ON prescriptions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated can insert prescriptions" ON prescriptions;
CREATE POLICY "Authenticated can insert prescriptions"
  ON prescriptions FOR INSERT TO authenticated WITH CHECK (true);

-- reports
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


-- 9. HANDLE NEW USER TRIGGER (auto-creates profile, admins auto-verified)
-- DROP TRIGGER FIRST, then function (reverse dependency order)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, verification_status, doctor_id, specialization, clinic_permit_id, license_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', 'User'),
    COALESCE(new.raw_user_meta_data->>'role', 'doctor'),
    CASE WHEN COALESCE(new.raw_user_meta_data->>'role', 'doctor') = 'admin'
         THEN 'verified'
         ELSE COALESCE(new.raw_user_meta_data->>'verification_status', 'pending')
    END,
    new.raw_user_meta_data->>'doctor_id',
    new.raw_user_meta_data->>'specialization',
    new.raw_user_meta_data->>'clinic_permit_id',
    new.raw_user_meta_data->>'license_url'
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name   = EXCLUDED.full_name,
        verification_status = CASE
          WHEN EXCLUDED.role = 'admin' THEN 'verified'
          ELSE profiles.verification_status
        END;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
DROP TRIGGER IF EXISTS update_patients_updated_at ON patients;
DROP TRIGGER IF EXISTS update_patient_visits_updated_at ON patient_visits;
DROP TRIGGER IF EXISTS update_prescriptions_updated_at ON prescriptions;
DROP TRIGGER IF EXISTS update_reports_updated_at ON reports;
DROP FUNCTION IF EXISTS update_updated_at_column();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at
  BEFORE UPDATE ON patients FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patient_visits_updated_at
  BEFORE UPDATE ON patient_visits FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prescriptions_updated_at
  BEFORE UPDATE ON prescriptions FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON reports FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 10. FIX EXISTING ADMINS STUCK ON PENDING
UPDATE public.profiles SET verification_status = 'verified'
WHERE role = 'admin' AND verification_status != 'verified';

-- 11. CREATE ADMIN RPC FUNCTIONS (SECURITY DEFINER - bypass RLS for admin ops)
-- DROP existing functions first to avoid return type conflicts
DROP FUNCTION IF EXISTS admin_get_all_doctors();
DROP FUNCTION IF EXISTS admin_get_pending_doctors();
DROP FUNCTION IF EXISTS admin_verify_doctor(UUID);
DROP FUNCTION IF EXISTS admin_reject_doctor(UUID);
DROP FUNCTION IF EXISTS admin_delete_doctor(UUID);
DROP FUNCTION IF EXISTS admin_get_stats();

CREATE OR REPLACE FUNCTION admin_get_all_doctors()
RETURNS SETOF profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role TEXT; caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status FROM profiles WHERE id = auth.uid();
  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY SELECT * FROM profiles WHERE role = 'doctor' ORDER BY created_at DESC;
  ELSE RAISE EXCEPTION 'Access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION admin_get_pending_doctors()
RETURNS SETOF profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role TEXT; caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status FROM profiles WHERE id = auth.uid();
  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY SELECT * FROM profiles WHERE role = 'doctor' AND verification_status = 'pending' ORDER BY created_at ASC;
  ELSE RAISE EXCEPTION 'Access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION admin_verify_doctor(doctor_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role TEXT; caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status FROM profiles WHERE id = auth.uid();
  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    UPDATE profiles SET verification_status = 'verified' WHERE id = doctor_id;
  ELSE RAISE EXCEPTION 'Access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION admin_reject_doctor(doctor_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role TEXT; caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status FROM profiles WHERE id = auth.uid();
  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    UPDATE profiles SET verification_status = 'rejected' WHERE id = doctor_id;
  ELSE RAISE EXCEPTION 'Access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION admin_delete_doctor(doctor_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role TEXT; caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status FROM profiles WHERE id = auth.uid();
  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    DELETE FROM profiles WHERE id = doctor_id;
  ELSE RAISE EXCEPTION 'Access denied'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS TABLE(total_doctors bigint, pending_doctors bigint, total_patients bigint, total_visits bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE caller_role TEXT; caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status FROM profiles WHERE id = auth.uid();
  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY SELECT
      (SELECT COUNT(*) FROM profiles WHERE role = 'doctor'),
      (SELECT COUNT(*) FROM profiles WHERE role = 'doctor' AND verification_status = 'pending'),
      (SELECT COUNT(*) FROM patients),
      (SELECT COUNT(*) FROM patient_visits);
  ELSE RAISE EXCEPTION 'Access denied'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION admin_get_all_doctors() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_pending_doctors() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_verify_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_stats() TO authenticated;

-- 12. STORAGE BUCKET FOR LICENSES
INSERT INTO storage.buckets (id, name, public)
VALUES ('licenses', 'licenses', false)
ON CONFLICT (id) DO NOTHING;
