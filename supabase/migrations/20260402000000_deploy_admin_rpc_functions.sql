/*
  # Deploy Admin RPC Functions for Doctor Verification

  These SECURITY DEFINER functions allow verified admins to approve/reject/delete doctors
  while bypassing RLS restrictions.
  
  Run this migration to enable admin approval workflow.
*/

-- ================================================================
-- Function: admin_verify_doctor
-- Purpose: Approve a pending doctor (admin only)
-- ================================================================

CREATE OR REPLACE FUNCTION admin_verify_doctor(p_doctor_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  -- Check that caller is a verified admin
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role != 'admin' OR caller_status != 'verified' THEN
    RAISE EXCEPTION 'Access denied: caller must be a verified admin';
  END IF;

  -- Update profiles table
  UPDATE profiles 
  SET verification_status = 'verified' 
  WHERE id = p_doctor_id AND role = 'doctor';

  -- Sync to auth.users metadata
  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{verification_status}',
    '"verified"',
    true
  )
  WHERE id = p_doctor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_verify_doctor(UUID) TO authenticated;

-- ================================================================
-- Function: admin_reject_doctor
-- Purpose: Reject a pending doctor (admin only)
-- ================================================================

CREATE OR REPLACE FUNCTION admin_reject_doctor(p_doctor_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  -- Check that caller is a verified admin
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role != 'admin' OR caller_status != 'verified' THEN
    RAISE EXCEPTION 'Access denied: caller must be a verified admin';
  END IF;

  -- Update profiles table
  UPDATE profiles 
  SET verification_status = 'rejected' 
  WHERE id = p_doctor_id AND role = 'doctor';

  -- Sync to auth.users metadata
  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
    COALESCE(raw_user_meta_data, '{}'::jsonb),
    '{verification_status}',
    '"rejected"',
    true
  )
  WHERE id = p_doctor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_reject_doctor(UUID) TO authenticated;

-- ================================================================
-- Function: admin_delete_doctor
-- Purpose: Delete a doctor profile (admin only)
-- ================================================================

CREATE OR REPLACE FUNCTION admin_delete_doctor(p_doctor_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  -- Check that caller is a verified admin
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role != 'admin' OR caller_status != 'verified' THEN
    RAISE EXCEPTION 'Access denied: caller must be a verified admin';
  END IF;

  -- Delete from profiles (cascades to related records)
  DELETE FROM profiles 
  WHERE id = p_doctor_id AND role = 'doctor';
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_doctor(UUID) TO authenticated;

-- ================================================================
-- Function: admin_get_all_doctors
-- Purpose: Get all doctor profiles with license URLs from storage
-- ================================================================

CREATE OR REPLACE FUNCTION admin_get_all_doctors()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  verification_status text,
  doctor_id text,
  license_url text,
  clinic_permit_id text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  -- Check that caller is a verified admin
  SELECT p.role, p.verification_status INTO caller_role, caller_status
  FROM profiles p WHERE p.id = auth.uid();

  IF caller_role != 'admin' OR caller_status != 'verified' THEN
    RAISE EXCEPTION 'Access denied: caller must be a verified admin';
  END IF;

  -- Return all doctors, preferring profiles.license_url, falling back to storage.objects
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.role,
    p.verification_status,
    p.doctor_id,
    COALESCE(p.license_url, s.name) AS license_url,
    p.clinic_permit_id,
    p.created_at,
    p.updated_at
  FROM profiles p
  LEFT JOIN storage.objects s 
    ON s.bucket_id = 'licenses' 
    AND s.name LIKE p.id || '/%'
  WHERE p.role = 'doctor'
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_all_doctors() TO authenticated;

-- ================================================================
-- Function: admin_get_pending_doctors
-- Purpose: Get pending (not yet approved) doctors for admin review
-- ================================================================

CREATE OR REPLACE FUNCTION admin_get_pending_doctors()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  verification_status text,
  doctor_id text,
  license_url text,
  clinic_permit_id text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  -- Check that caller is a verified admin
  SELECT p.role, p.verification_status INTO caller_role, caller_status
  FROM profiles p WHERE p.id = auth.uid();

  IF caller_role != 'admin' OR caller_status != 'verified' THEN
    RAISE EXCEPTION 'Access denied: caller must be a verified admin';
  END IF;

  -- Return pending doctors
  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.role,
    p.verification_status,
    p.doctor_id,
    COALESCE(p.license_url, s.name) AS license_url,
    p.clinic_permit_id,
    p.created_at,
    p.updated_at
  FROM profiles p
  LEFT JOIN storage.objects s 
    ON s.bucket_id = 'licenses' 
    AND s.name LIKE p.id || '/%'
  WHERE p.role = 'doctor' AND p.verification_status = 'pending'
  ORDER BY p.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_pending_doctors() TO authenticated;

-- ================================================================
-- Function: admin_get_stats
-- Purpose: Get dashboard stats for admin
-- ================================================================

CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS TABLE (
  total_doctors bigint,
  pending_doctors bigint,
  total_patients bigint,
  total_visits bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  -- Check that caller is a verified admin
  SELECT p.role, p.verification_status INTO caller_role, caller_status
  FROM profiles p WHERE p.id = auth.uid();

  IF caller_role != 'admin' OR caller_status != 'verified' THEN
    RAISE EXCEPTION 'Access denied: caller must be a verified admin';
  END IF;

  -- Return stats
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM profiles WHERE role = 'doctor')::bigint AS total_doctors,
    (SELECT COUNT(*) FROM profiles WHERE role = 'doctor' AND verification_status = 'pending')::bigint AS pending_doctors,
    (SELECT COUNT(*) FROM patients)::bigint AS total_patients,
    (SELECT COUNT(*) FROM patient_visits)::bigint AS total_visits;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_get_stats() TO authenticated;

-- ================================================================
-- Verification: Check that all functions are deployed
-- ================================================================

SELECT 
  'RPC Functions Deployed Successfully' AS status,
  COUNT(*) AS function_count
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN (
  'admin_verify_doctor',
  'admin_reject_doctor', 
  'admin_delete_doctor',
  'admin_get_all_doctors',
  'admin_get_pending_doctors',
  'admin_get_stats'
);