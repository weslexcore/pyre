// Homepage hero video behavior: apply each video's `data-playback-rate`, and
// pause while the tab is hidden. The video keeps playing as the content cards
// scroll up over it, so it shows through between them.

function applyPlaybackRate(video: HTMLVideoElement) {
  const raw = video.dataset.playbackRate;
  const rate = raw ? parseFloat(raw) : 1;
  if (!Number.isNaN(rate) && video.playbackRate !== rate) {
    video.playbackRate = rate;
  }
}

export function initHeroVideos(): () => void {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-hero-video]'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onRateChange = (e: Event) => applyPlaybackRate(e.currentTarget as HTMLVideoElement);
  const onVisibilityChange = () => {
    for (const video of videos) {
      if (document.hidden || reduceMotion) video.pause();
      else video.play().catch(() => {});
    }
  };

  for (const video of videos) {
    applyPlaybackRate(video);
    video.addEventListener('play', onRateChange);
    video.addEventListener('ratechange', onRateChange);
    if (reduceMotion) video.pause();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    for (const video of videos) {
      video.removeEventListener('play', onRateChange);
      video.removeEventListener('ratechange', onRateChange);
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
