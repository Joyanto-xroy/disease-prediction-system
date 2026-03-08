/*
  # Add vitals and blood_group columns

  1. Add `vitals` (jsonb) to patient_visits to store structured vitals data
  2. Add `blood_group` (text) to patients
  3. Add `visit_type` (text) to patient_visits
*/

ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS vitals jsonb;
ALTER TABLE patient_visits ADD COLUMN IF NOT EXISTS visit_type text DEFAULT 'consultation';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS blood_group text;
