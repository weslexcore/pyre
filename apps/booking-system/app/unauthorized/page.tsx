'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Mail, ArrowLeft } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

function UnauthorizedContent() {
  const searchParams = useSearchParams();
  const reason = searchParams?.get('reason');

  const isEmailConfirmationRequired = reason === 'email_confirmation_required';

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              {isEmailConfirmationRequired ? (
                <Mail className="h-6 w-6 text-destructive" />
              ) : (
                <AlertCircle className="h-6 w-6 text-destructive" />
              )}
            </div>
            <CardTitle className="text-2xl">
              {isEmailConfirmationRequired ? 'Email Confirmation Required' : 'Access Denied'}
            </CardTitle>
            <CardDescription>
              {isEmailConfirmationRequired
                ? 'Please confirm your email address to continue'
                : 'You do not have permission to access this page'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isEmailConfirmationRequired ? (
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  To access your account and protected features, you need to confirm your email
                  address first.
                </p>
                <div className="space-y-3">
                  <p className="text-sm font-medium">What to do next:</p>
                  <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside text-left">
                    <li>Check your email inbox for a confirmation message</li>
                    <li>Click the confirmation link in the email</li>
                    <li>Complete your profile setup</li>
                    <li>Return to access your account</li>
                  </ol>
                </div>
                <div className="pt-4 space-y-3">
                  <Link href="/auth/sign-up-success" className="block">
                    <Button variant="default" className="w-full">
                      <Mail className="mr-2 h-4 w-4" />
                      Resend Confirmation Email
                    </Button>
                  </Link>
                  <Link href="/schedule" className="block">
                    <Button variant="outline" className="w-full">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Browse Schedule
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-sm text-muted-foreground">
                  You don&apos;t have the necessary permissions to view this content.
                </p>
                <div className="pt-4 space-y-3">
                  <Link href="/" className="block">
                    <Button variant="default" className="w-full">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Go Home
                    </Button>
                  </Link>
                  <Link href="/auth/login" className="block">
                    <Button variant="outline" className="w-full">
                      Sign In
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function UnauthorizedPage() {
  return (
    <Suspense 
      fallback={
        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
          <div className="w-full max-w-md">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <AlertCircle className="h-6 w-6 text-muted-foreground animate-pulse" />
                </div>
                <CardTitle className="text-2xl">Loading...</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </div>
      }
    >
      <UnauthorizedContent />
    </Suspense>
  );
}
