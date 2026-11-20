// This suite's Supabase stack: the shared e2e stack (packages/e2e-utils
// src/supabase.ts), built from apps/supabase and serving the app on APP_PORT.
//
//   yarn workspace @pyre/integrations e2e:supabase:reset   throw its data away and replay every migration
//   yarn workspace @pyre/integrations e2e:supabase:stop    stop its containers

import { fileURLToPath } from 'node:url';
import {
  ensureLocalSupabase,
  type LocalSupabaseOptions,
  resetLocalSupabase,
  stopLocalSupabase,
} from '@pyre/e2e-utils/server';
import { SUPABASE_APP_PORT } from './ports';

const options: LocalSupabaseOptions = {
  supabaseDir: fileURLToPath(new URL('../../supabase', import.meta.url)),
  appOrigin: `http://localhost:${SUPABASE_APP_PORT}`,
};

/** Start or reuse the stack, migrated, and return its URLs and keys. */
export const supabaseStack = () => ensureLocalSupabase(options);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'reset') resetLocalSupabase(options);
  else if (command === 'stop') stopLocalSupabase(options);
  else console.log(JSON.stringify(supabaseStack(), null, 2));
}
