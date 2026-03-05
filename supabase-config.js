const SUPABASE_URL = 'https://jgrrabphvcffchictqqj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpncnJhYnBodmNmZmNoaWN0cXFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MzkzNzMsImV4cCI6MjA4ODIxNTM3M30.LTkm_kH4BMBNvI7kOmSSN44cY-w6BQBpaNQJ1Qk9zwQ';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export { supabase };
