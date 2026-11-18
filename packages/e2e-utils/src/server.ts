// Playwright-free entry for code that runs in a plain Node process (the mock
// upstream servers and their fixtures): importing the main entry would load
// @playwright/test outside the test runner.

export { REFERRAL, REFERRAL_UNKNOWN, type ReferralLookup } from './contracts/referral';
export { daysFromNow } from './dates';
export {
  createMockServer,
  type MockHandler,
  type MockOverride,
  type MockRequest,
  type MockResponse,
  type MockRoute,
  type MockServerOptions,
  mockServerClient,
  type RecordedRequest,
  runMockServer,
} from './mock-server';
export {
  type AuthUserInput,
  emailLinks,
  ensureAuthUser,
  findAuthUser,
  type MailpitMessage,
  type MailpitMessageDetail,
  mailpitClient,
  type SessionCookie,
  supabaseAdmin,
  supabaseSessionCookies,
} from './supabase-admin';
export {
  ensureLocalSupabase,
  type LocalSupabase,
  type LocalSupabaseOptions,
  resetLocalSupabase,
  stopLocalSupabase,
} from './supabase';
