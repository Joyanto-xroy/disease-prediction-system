-- Backfill license_url for existing doctor profiles with the storage path

UPDATE profiles
SET license_url = (
  SELECT name
  FROM storage.objects
  WHERE bucket_id = 'licenses' AND name LIKE profiles.id || '/%'
  LIMIT 1
)
WHERE role = 'doctor' AND (license_url IS NULL OR license_url = '');