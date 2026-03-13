/*
  # Create profiles table for clinical support system

  1. New Tables
    - `profiles`
      - `id` (uuid, primary key) - references auth.users
      - `email` (text) - user email
      - `full_name` (text) - user's full name
      - `role` (text) - user role: 'admin' or 'doctor'
      - `created_at` (timestamptz) - account creation timestamp
      - `updated_at` (timestamptz) - last update timestamp
  
  2. Security
    - Enable RLS on `profiles` table
    - Add policy for users to read their own profile
    - Add policy for users to update their own profile
    - Add policy for admins to read all profiles
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'doctor')),
  verification_status text DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  doctor_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.jwt()->'user_metadata'->>'role' = 'admin');

-- Function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, verification_status, doctor_id)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', 'User'),
    COALESCE(new.raw_user_meta_data->>'role', 'doctor'),
    CASE WHEN COALESCE(new.raw_user_meta_data->>'role', 'doctor') = 'admin' THEN 'verified' ELSE 'pending' END,
    new.raw_user_meta_data->>'doctor_id'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile automatically
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create storage bucket for licenses
INSERT INTO storage.buckets (id, name, public)
VALUES ('licenses', 'licenses', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for licenses bucket
CREATE POLICY "Users can upload their own license"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'licenses' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own license"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'licenses' AND auth.uid()::text = (storage.foldername(name))[1]);

<<<<<<< HEAD
=======
CREATE POLICY "Admins can view all licenses"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'licenses' AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
    AND profiles.verification_status = 'verified'
  ));

>>>>>>> 95215ca (few updates of doctor adding)
CREATE POLICY "Admins can read all profiles"
ON profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'admin'
  )
);