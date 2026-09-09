// The "Hosted by" credit together with the bio modal it opens.
//
// On the schedule this pairing lives inside EventsGrid, which already owns the
// selected-practitioner state so the bio can layer over the event modal. The
// event page has no such container, so the byline and its modal travel together
// here as one island.

import { lazy, Suspense, useState } from 'react';
import type { Practitioner } from '@/lib/types';
import PractitionerByline from './PractitionerByline';

const PractitionerBioModal = lazy(() => import('./PractitionerBioModal'));

export default function PractitionerCredit({ practitioners }: { practitioners: Practitioner[] }) {
  const [selected, setSelected] = useState<Practitioner | null>(null);

  if (practitioners.length === 0) return null;

  return (
    <>
      {/* Byline renders a plain credit for anyone the roster has no bio for,
          so passing the handler doesn't invent a control that opens nothing. */}
      <PractitionerByline practitioners={practitioners} variant="modal" onOpenBio={setSelected} />
      <Suspense fallback={null}>
        <PractitionerBioModal
          practitioner={selected}
          isOpen={!!selected}
          onClose={() => setSelected(null)}
        />
      </Suspense>
    </>
  );
}
