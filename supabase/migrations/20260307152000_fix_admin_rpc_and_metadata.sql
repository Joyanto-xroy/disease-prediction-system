-- Fix admin RPCs: avoid ambiguous parameter names and sync auth.user metadata

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
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    -- Update profiles table
    UPDATE profiles SET verification_status = 'verified' WHERE id = p_doctor_id AND role = 'doctor';
    -- Sync auth.users raw_user_meta_data -> verification_status
    UPDATE auth.users
      SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}')::jsonb, '{verification_status}', '"verified"', true)
      WHERE id = p_doctor_id;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

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
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    UPDATE profiles SET verification_status = 'rejected' WHERE id = p_doctor_id AND role = 'doctor';
    UPDATE auth.users
      SET raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}')::jsonb, '{verification_status}', '"rejected"', true)
      WHERE id = p_doctor_id;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

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
  SELECT role, verification_status INTO caller_role, caller_status
  FROM profiles WHERE id = auth.uid();

  IF caller_role = 'admin' AND caller_status = 'verified' THEN
    DELETE FROM profiles WHERE id = p_doctor_id AND role = 'doctor';
    -- Optionally remove auth.user (commented out to avoid accidental deletions)
    -- DELETE FROM auth.users WHERE id = p_doctor_id;
  ELSE
    RAISE EXCEPTION 'Access denied';
  END IF;
END;
$$;

-- Ensure execute granted
GRANT EXECUTE ON FUNCTION admin_verify_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reject_doctor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_doctor(UUID) TO authenticated;
