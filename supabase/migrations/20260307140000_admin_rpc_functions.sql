/*
  # Admin Helper Functions (SECURITY DEFINER)

  These functions run with elevated privileges to bypass RLS,
  allowing verified admins to query all profiles, patients, and visits
  without hitting the recursive or restrictive RLS policies.

  Each function checks that the caller is a verified admin via the
  profiles table before returning data.
*/

-- Function: get all doctor profiles for admin
CREATE OR REPLACE FUNCTION admin_get_all_doctors()
RETURNS SETOF profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY SELECT * FROM profiles WHERE role = 'doctor' ORDER BY created_at DESC;
  ELSE
    RAISE EXCEPTION 'Access denied: caller is not a verified admin';
  END IF;
END;
$$;

-- Function: get pending doctor profiles for admin
CREATE OR REPLACE FUNCTION admin_get_pending_doctors()
RETURNS SETOF profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY SELECT * FROM profiles WHERE role = 'doctor' AND verification_status = 'pending' ORDER BY created_at ASC;
  ELSE
    RAISE EXCEPTION 'Access denied: caller is not a verified admin';
  END IF;
END;
$$;

-- Function: approve a doctor by admin
CREATE OR REPLACE FUNCTION admin_verify_doctor(doctor_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    UPDATE profiles SET verification_status = 'verified' WHERE id = doctor_id AND role = 'doctor';
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

-- Function: reject a doctor by admin
CREATE OR REPLACE FUNCTION admin_reject_doctor(doctor_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    UPDATE profiles SET verification_status = 'rejected' WHERE id = doctor_id AND role = 'doctor';
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

-- Function: delete a doctor by admin
CREATE OR REPLACE FUNCTION admin_delete_doctor(doctor_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    DELETE FROM profiles WHERE id = doctor_id AND role = 'doctor';
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

-- Function: get all patients for admin
CREATE OR REPLACE FUNCTION admin_get_all_patients()
RETURNS TABLE(
  id uuid,
  created_by uuid,
  full_name text,
  date_of_birth date,
  gender text,
  phone text,
  email text,
  address text,
  blood_group text,
  emergency_contact_name text,
  emergency_contact_phone text,
  medical_history text,
  allergies text,
  current_medications text,
  created_at timestamptz,
  updated_at timestamptz,
  doctor_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY
      SELECT p.id, p.created_by, p.full_name, p.date_of_birth, p.gender,
             p.phone, p.email, p.address, p.blood_group,
             p.emergency_contact_name, p.emergency_contact_phone,
             p.medical_history, p.allergies, p.current_medications,
             p.created_at, p.updated_at,
             pr.full_name as doctor_name
      FROM patients p
      LEFT JOIN profiles pr ON p.created_by = pr.id
      ORDER BY p.created_at DESC;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

-- Function: admin get dashboard stats
CREATE OR REPLACE FUNCTION admin_get_stats()
RETURNS TABLE(total_doctors bigint, pending_doctors bigint, total_patients bigint, total_visits bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
  caller_status TEXT;
BEGIN
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    RETURN QUERY
      SELECT
        (SELECT COUNT(*) FROM profiles WHERE role = 'doctor'),
        (SELECT COUNT(*) FROM profiles WHERE role = 'doctor' AND verification_status = 'pending'),
        (SELECT COUNT(*) FROM patients),
        (SELECT COUNT(*) FROM patient_visits);
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

-- Grant execute to authenticated users (function internally checks admin role)
GRANT EXECUTE ON FUNCTION admin_get_all_doctors() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_pending_doctors() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_verify_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_all_patients() TO authenticated;
GRANT EXECUTE ON FUNCTION admin_get_stats() TO authenticated;
