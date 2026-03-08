/*
  # Fix admin auto-verification

  The handle_new_user trigger must automatically set
  verification_status = 'verified' for admin users.
  The second migration file overwrote the function without
  the CASE statement, breaking this. This re-applies it.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, verification_status, doctor_id, clinic_permit_id, license_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', 'User'),
    COALESCE(new.raw_user_meta_data->>'role', 'doctor'),
    -- Admins are immediately verified; doctors start as pending
    CASE WHEN COALESCE(new.raw_user_meta_data->>'role', 'doctor') = 'admin'
         THEN 'verified'
         ELSE 'pending'
    END,
    new.raw_user_meta_data->>'doctor_id',
    new.raw_user_meta_data->>'clinic_permit_id',
    new.raw_user_meta_data->>'license_url'
  )
  ON CONFLICT (id) DO UPDATE
    SET verification_status = CASE
      WHEN EXCLUDED.role = 'admin' THEN 'verified'
      ELSE profiles.verification_status
    END;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also fix any existing admin accounts that are stuck in 'pending'
UPDATE public.profiles
SET verification_status = 'verified'
WHERE role = 'admin' AND verification_status = 'pending';
