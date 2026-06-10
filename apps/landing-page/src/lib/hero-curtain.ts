import { getScrollData, onScroll, type ScrollData } from './scroll-coordinator';

const PAUSE_THRESHOLD = 0.95;
const RESUME_THRESHOLD = 0.85;
const PROGRESS_EPSILON = 0.001;

function applyPlaybackRate(video: HTMLVideoElement) {
  const raw = video.dataset.playbackRate;
  const rate = raw ? parseFloat(raw) : 1;
  if (!Number.isNaN(rate) && video.playbackRate !== rate) {
    video.playbackRate = rate;
  }
}

function setupVideo(video: HTMLVideoElement) {
  applyPlaybackRate(video);
  video.addEventListener('play', () => applyPlaybackRate(video));
  video.addEventListener('ratechange', () => applyPlaybackRate(video));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      video.pause();
    } else if (!video.dataset.curtainPaused) {
      video.play().catch(() => {});
    }
  });
}

function pauseWhenCovered(video: HTMLVideoElement, progress: number) {
  if (progress >= PAUSE_THRESHOLD && !video.dataset.curtainPaused) {
    video.pause();
    video.dataset.curtainPaused = '1';
  } else if (progress <= RESUME_THRESHOLD && video.dataset.curtainPaused) {
    delete video.dataset.curtainPaused;
    if (!document.hidden) video.play().catch(() => {});
  }
}

export function initHeroCurtain(): (() => void) | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video[data-hero-video]'));
  for (const v of videos) setupVideo(v);

  const curtains = Array.from(document.querySelectorAll<HTMLElement>('[data-hero-curtain]'));
  const mobileVideo = document.querySelector<HTMLVideoElement>('video[data-hero-video="mobile"]');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    for (const curtain of curtains) curtain.style.transform = 'translate3d(0, 0, 0)';
    for (const v of videos) {
      v.pause();
      v.dataset.curtainPaused = '1';
    }
    return null;
  }

  const pairs = curtains.map((curtain) => {
    const role = curtain.dataset.heroCurtain ?? '';
    const video = document.querySelector<HTMLVideoElement>(`video[data-hero-video="${role}"]`);
    return { curtain, video };
  });

  let lastProgress = -1;

  function update(data: ScrollData) {
    const progress = Math.max(0, Math.min(1, data.scrollY / data.innerHeight));
    if (Math.abs(progress - lastProgress) < PROGRESS_EPSILON) return;
    lastProgress = progress;

    const ty = (1 - progress) * 100;
    const transform = `translate3d(0, ${ty}%, 0)`;

    for (const { curtain, video } of pairs) {
      curtain.style.transform = transform;
      if (video) pauseWhenCovered(video, progress);
    }

    // Mobile uses CSS sticky (no curtain element), but still pause its video
    // once the sticky tile has fully covered the viewport.
    if (mobileVideo && !pairs.some((p) => p.video === mobileVideo)) {
      pauseWhenCovered(mobileVideo, progress);
    }
  }

  update(getScrollData());
  return onScroll(update);
}
