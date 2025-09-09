'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { Mail, Clock, RefreshCw } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function Page() {
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [cooldownTime, setCooldownTime] = useState(0);
  const searchParams = useSearchParams();
  const email = searchParams?.get('email');

  // Cooldown timer effect
  useEffect(() => {
    if (cooldownTime > 0) {
      const timer = setTimeout(() => setCooldownTime(cooldownTime - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownTime]);

  const handleResendConfirmation = async () => {
    if (!email) {
      setResendMessage('No email address found. Please try signing up again.');
      return;
    }

    setIsResending(true);
    setResendMessage(null);
    
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent('/complete-profile')}`,
        },
      });

      if (error) {
        if (error.message.includes('Email rate limit exceeded')) {
          setResendMessage('Please wait before requesting another email. Check your spam folder.');
          setCooldownTime(60); // 60 second cooldown
        } else {
          setResendMessage('Failed to resend confirmation email. Please try again.');
        }
      } else {
        setResendMessage('Confirmation email resent! Please check your inbox and spam folder.');
        setCooldownTime(60); // 60 second cooldown
      }
    } catch (error) {
      setResendMessage('An unexpected error occurred. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">Check your email</CardTitle>
              <CardDescription>
                We&apos;ve sent a confirmation link to{email && (
                  <span className="block font-medium text-foreground mt-1">{email}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to confirm your account and complete your profile setup.
                </p>
                
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>The confirmation link will expire in 24 hours</span>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Didn&apos;t receive the email?</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Check your spam or junk folder</li>
                  <li>Make sure {email || 'your email address'} is correct</li>
                  <li>Wait a few minutes for the email to arrive</li>
                </ul>
              </div>

              {resendMessage && (
                <div className={`p-3 rounded-lg text-sm ${
                  resendMessage.includes('resent') || resendMessage.includes('sent')
                    ? 'bg-green-50 text-green-800 border border-green-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {resendMessage}
                </div>
              )}

              <div className="space-y-3">
                <Button
                  onClick={handleResendConfirmation}
                  disabled={isResending || cooldownTime > 0 || !email}
                  variant="outline"
                  className="w-full"
                >
                  {isResending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                  {cooldownTime > 0 
                    ? `Resend in ${cooldownTime}s`
                    : isResending 
                      ? 'Sending...' 
                      : 'Resend confirmation email'
                  }
                </Button>

                <div className="text-center">
                  <Link 
                    href="/auth/login" 
                    className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                  >
                    Back to login
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
