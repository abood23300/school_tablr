// إعدادات الاتصال بمشروع Supabase
// SUPABASE_ANON_KEY آمن للوضع في كود المتصفح طالما RLS مفعّلة على الجداول (راجع supabase/schema.sql)
const SUPABASE_URL = 'https://rkvomadwplcfvxckecph.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrdm9tYWR3cGxjZnZ4Y2tlY3BoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTY4MDMsImV4cCI6MjEwNDc5MjgwM30.JciNKPFVNtZT71XES5tMjcetZJelB3R1vQpaudyXyyQ';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
