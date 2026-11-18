// Ports this suite serves on. The landing page's suite uses 4329/4330, and the
// e2e Supabase stack 553xx (packages/e2e-utils src/supabase.ts).

export const APP_PORT = 4339;
export const MOCK_PORT = 4340;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const MOCK_URL = `http://localhost:${MOCK_PORT}`;
