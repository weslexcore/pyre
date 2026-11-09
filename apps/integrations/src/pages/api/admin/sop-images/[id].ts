// One SOP image: what `![Alt](/api/admin/sop-images/<id>)` loads from. GET
// signs a link, PATCH renames, DELETE removes; see sopMediaFileRoutes in
// lib/sops/media-server.

import { sopMediaFileRoutes } from '@/lib/sops/media-server';

export const { GET, PATCH, DELETE } = sopMediaFileRoutes('image');
