describe('cookie-config', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  test('getOptimizedCookieOptions uses secure in production', async () => {
    process.env.NODE_ENV = 'production';
    const mod = await import('./cookie-config');
    const opts = mod.getOptimizedCookieOptions();
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('lax');
  });

  test('getOptimizedCookieOptions not secure in development', async () => {
    process.env.NODE_ENV = 'development';
    const mod = await import('./cookie-config');
    const opts = mod.getOptimizedCookieOptions();
    expect(opts.secure).toBe(false);
  });

  test('safari optimized cookie options enforce secure and none samesite', async () => {
    const mod = await import('./cookie-config');
    const opts = mod.getSafariOptimizedCookieOptions();
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe('none');
  });
});
