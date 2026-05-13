export type SizeKey = 'square' | 'portrait' | 'landscape' | 'reel' | 'story';

export interface Size {
  w: number;
  h: number;
  label: string;
}

export const SIZES: Record<SizeKey, Size> = {
  square: { w: 1080, h: 1080, label: '1:1' },
  portrait: { w: 1080, h: 1350, label: '4:5' },
  landscape: { w: 1080, h: 566, label: '1.91:1' },
  reel: { w: 1080, h: 1920, label: '9:16' },
  story: { w: 1080, h: 1920, label: '9:16' },
};

export const SIZE_KEYS = Object.keys(SIZES) as SizeKey[];
