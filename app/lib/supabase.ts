import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://kedggjyerexnzmipaick.supabase.co";
const supabasePublishableKey = "sb_publishable_WoobBV7n0p5Jf-4DLJVzIA_4sUoAvsT";

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

