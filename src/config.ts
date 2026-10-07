export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export let isConfigured = () => SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
