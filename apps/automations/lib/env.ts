function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get META_APP_SECRET() {
    return required("META_APP_SECRET");
  },
  get META_VERIFY_TOKEN() {
    return required("META_VERIFY_TOKEN");
  },
  get IG_PAGE_ACCESS_TOKEN() {
    return required("IG_PAGE_ACCESS_TOKEN");
  },
  get IG_BUSINESS_ACCOUNT_ID() {
    return required("IG_BUSINESS_ACCOUNT_ID");
  },
  get SUPABASE_URL() {
    return required("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
};
