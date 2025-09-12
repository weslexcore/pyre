'use client';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useId, useEffect } from 'react';
import { useAuthState } from '@/hooks/use-auth-state';
import { sessionValidator } from '@/lib/supabase/session-validator';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();
  const { isAuthenticated } = useAuthState();

  useEffect(() => {
    if (isAuthenticated && isLoading) {
      const handleSuccessfulAuth = async () => {
        try {
          setLoadingMessage('Validating session...');

          // Validate session before navigation
          const validation = await sessionValidator.validateSession({ requireAuth: true });

          if (validation.isValid) {
            setLoadingMessage('Redirecting to your account...');
            router.replace('/account');
          } else {
            const errorMessage = 'Authentication validation failed. Please try again.';
            setError(errorMessage);
            setLoadingMessage('');
          }
        } catch {
          const errorMessage = 'Session validation error. Please try again.';
          setError(errorMessage);
          setLoadingMessage('');
        } finally {
          setIsLoading(false);
        }
      };

      handleSuccessfulAuth();
    }
  }, [isAuthenticated, isLoading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);
    setLoadingMessage('Signing in...');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;

      setLoadingMessage('Authentication successful...');
      // Auth state change will be handled by useEffect above
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred';
      setError(errorMessage);
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your email below to login to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor={emailId}>Email</Label>
                <Input
                  id={emailId}
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor={passwordId}>Password</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input
                  id={passwordId}
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              {loadingMessage && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <LoadingSpinner size="sm" />
                  {loadingMessage}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <LoadingSpinner size="sm" />
                    {loadingMessage || 'Logging in...'}
                  </div>
                ) : (
                  'Login'
                )}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Don&apos;t have an account?{' '}
              <Link href="/auth/sign-up" className="underline underline-offset-4">
                Sign up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
