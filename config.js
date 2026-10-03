/*
 * Team configuration for Preach. This file is public once the site is hosted,
 * so only put PUBLIC values here (the Supabase anon key is designed to be public;
 * Row Level Security in supabase/schema.sql is what protects the data).
 *
 * supabaseUrl / supabaseAnonKey: from Supabase → Project Settings → API.
 *   Leave both empty and the app runs local-only (no accounts, no sync).
 * apiBibleKey: optional API.Bible key with CSB enabled. A key typed in Settings overrides it.
 */
window.PREACH_CONFIG = {
  supabaseUrl: 'https://bpndhidtxzgjxmrgffyp.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwbmRoaWR0eHpnanhtcmdmZnlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMTE5NjMsImV4cCI6MjEwNjU4Nzk2M30.-31EEjZw16XPnbEfqyj3XVWX93XnaT2P61S49mLBmY4',  // anon (public) key
  apiBibleKey: 'EKJqZ9D2Ekpn3IyUm1Cav'
};
