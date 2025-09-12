'use client';

import { Toaster } from 'sonner';
import { useTheme } from 'next-themes';

export function ToastProvider() {
  const { theme } = useTheme();

  return (
    <Toaster
      theme={theme === 'dark' ? 'dark' : 'light'}
      position="top-right"
      expand={true}
      richColors
      closeButton
      toastOptions={{
        style: {
          fontFamily: 'var(--font-pyre-mono)',
        },
      }}
    />
  );
}
