/*
  # Fix infinite recursion in profiles RLS policy

  1. Issue
    - The "Admins can read all profiles" policy had a circular dependency because it queried the profiles table to verify if the user was an admin.
    - This caused an error: "infinite recursion detected in policy for relation 'profiles'".

  2. Fix
    - Drop the existing recursive policy.
    - Create a new policy that relies purely on the secure `role` stored in the JWT (`auth.jwt()->'user_metadata'->>'role'`). This avoids querying the profiles table entirely.
*/

-- Drop the recursive policy from the first migration
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;

-- Add the corrected policy back
CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );
