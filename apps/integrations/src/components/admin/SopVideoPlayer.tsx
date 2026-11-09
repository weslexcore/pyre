// A library video embedded in an SOP (see lib/sops/media): drawn by
// SopMarkdown wherever a document has `![Title](/api/admin/sop-videos/<id>)`.
//
// The src is the app's own route, which redirects to a signed link that
// lasts ten minutes. A reader who pauses longer than that and resumes would
// hit an expired link mid-stream, so on a playback error the player asks the
// route for a fresh link once and carries on from where it was.
import { useRef, useState } from 'react';
import { sopMediaSrc } from '@/lib/sops/media';

export function SopVideoPlayer({
  id,
  title,
  start,
}: {
  id: string;
  title?: string;
  /** Seconds to start from (`#t=` on the reference). */
  start?: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Bumped to reload the source; part of the src so the browser re-requests.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const resumeAt = useRef<number | null>(start ?? null);

  const src =
    attempt === 0
      ? sopMediaSrc({ kind: 'video', id })
      : `${sopMediaSrc({ kind: 'video', id })}?r=${attempt}`;
  const caption = title?.trim();

  return (
    // A span, not a figure: markdown puts an image inside a paragraph, and a
    // block element there is invalid HTML.
    <span className="my-4 block overflow-hidden rounded border border-white/10 bg-black">
      {failed ? (
        <span className="flex aspect-video items-center justify-center px-4 text-center text-xs text-white/50">
          This video couldn’t be loaded. It may have been removed from the library.
        </span>
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: staff walkthroughs carry no caption track
        <video
          ref={videoRef}
          key={src}
          src={src}
          controls
          playsInline
          preload="metadata"
          // A reload after an expired link carries on playing.
          autoPlay={attempt > 0}
          aria-label={caption || 'Video walkthrough'}
          className="block aspect-video w-full bg-black"
          onLoadedMetadata={(e) => {
            const at = resumeAt.current;
            if (at !== null && at > 0 && at < e.currentTarget.duration) {
              e.currentTarget.currentTime = at;
            }
            resumeAt.current = null;
          }}
          onError={() => {
            if (attempt >= 1) {
              setFailed(true);
              return;
            }
            resumeAt.current = videoRef.current?.currentTime || (start ?? null);
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {caption && (
        <span className="block border-t border-white/10 px-3 py-2 text-xs text-white/60">
          <span aria-hidden="true" className="mr-1.5 text-[var(--pyre-gold)]">
            ▶
          </span>
          {caption}
        </span>
      )}
    </span>
  );
}
