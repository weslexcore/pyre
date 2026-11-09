// One SOP video walkthrough: what `![Title](/api/admin/sop-videos/<id>)`
// plays from. GET signs a link, PATCH renames, DELETE removes; see
// sopMediaFileRoutes in lib/sops/media-server.

import { sopMediaFileRoutes } from '@/lib/sops/media-server';

export const { GET, PATCH, DELETE } = sopMediaFileRoutes('video');
