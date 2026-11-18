// Ports this suite serves on. The landing page's suite uses 4329/4330, and the
// e2e Supabase stack 553xx (packages/e2e-utils src/supabase.ts).
//
// E2E_APP_PORT / E2E_MOCK_PORT move the app and mock server, so two runs can
// go side by side against the one Supabase stack. The stack's Auth settings
// keep naming 4339 (SUPABASE_APP_PORT): changing them restarts the stack, and
// only the emailed sign-in link depends on them.

export const APP_PORT = Number(process.env.E2E_APP_PORT) || 4339;
export const MOCK_PORT = Number(process.env.E2E_MOCK_PORT) || 4340;
export const SUPABASE_APP_PORT = 4339;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const MOCK_URL = `http://localhost:${MOCK_PORT}`;
