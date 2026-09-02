// Disabled framework default: neither role runs shell commands, touches the
// sandbox filesystem, reaches the web, delegates, or parks on questions —
// the scheduler works from get_week_context, the knowledge assistant from
// the knowledge base, and both answer in one pass. See agent/tools/role_tools.ts.
import { disableTool } from 'eve/tools';

export default disableTool();
