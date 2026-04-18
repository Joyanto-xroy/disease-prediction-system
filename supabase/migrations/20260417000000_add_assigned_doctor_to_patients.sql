-- Add assigned_doctor field to patients table
-- This allows admins to assign patients to specific doctors

ALTER TABLE patients ADD COLUMN IF NOT EXISTS assigned_doctor uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_patients_assigned_doctor ON patients(assigned_doctor);

-- Update RLS policies to allow doctors to see their assigned patients
-- (This will be handled in the application logic)