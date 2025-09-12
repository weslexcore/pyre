'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSessionValidation } from '@/hooks/use-session-validation';
import { useSessionPersistence } from '@/hooks/use-session-persistence';
import { useBrowserCompatibility } from '@/hooks/use-browser-compatibility';
import { useAuthTransition } from '@/components/providers/auth-transition-provider';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle, Clock, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

export interface SessionHealthMonitorProps {
  enabled?: boolean;
  showUI?: boolean;
  autoRecover?: boolean;
  onHealthChange?: (isHealthy: boolean) => void;
}

export function SessionHealthMonitor({
  enabled = true,
  showUI = false,
  autoRecover = true,
  onHealthChange,
}: SessionHealthMonitorProps) {
  const [lastHealthCheck, setLastHealthCheck] = useState<Date | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  const { showTransition } = useAuthTransition();

  const sessionValidation = useSessionValidation({
    autoValidate: enabled,
    validationInterval: 30000, // 30 seconds
    requireAuth: false,
    cacheKey: 'health-monitor',
    onValidationComplete: (result) => {
      setLastHealthCheck(new Date());

      if (!result.isValid && result.error && autoRecover) {
        handleSessionRecovery();
      }
    },
    onValidationError: (error) => {
      console.warn('Session validation error:', error);
      if (autoRecover) {
        handleSessionRecovery();
      }
    },
  });

  const sessionPersistence = useSessionPersistence();
  const browserCompatibility = useBrowserCompatibility();

  const handleSessionRecovery = async () => {
    if (isRecovering) return;

    setIsRecovering(true);
    showTransition('Recovering session...', 0);

    try {
      // Attempt validation with force refresh
      await sessionValidation.validate(true);

      toast.success('Session recovered', {
        description: 'Your session has been successfully recovered.',
      });
    } catch (error) {
      toast.error('Session recovery failed', {
        description:
          error instanceof Error
            ? error.message
            : 'Unable to recover session. Please log in again.',
      });
    } finally {
      setIsRecovering(false);
    }
  };

  const calculateHealthScore = useCallback(() => {
    let score = 100;
    const issues = [];

    // Session validation health
    if (sessionValidation.result) {
      if (!sessionValidation.result.isValid) {
        score -= 40;
        issues.push('Session validation failed');
      } else if (sessionValidation.result.retryCount > 0) {
        score -= 20;
        issues.push(`Session required ${sessionValidation.result.retryCount} retries`);
      }
    }

    // Session persistence health
    if (sessionPersistence.hasValidationError) {
      score -= 30;
      issues.push('Session persistence issues detected');
    }

    // Browser compatibility
    if (browserCompatibility.report && browserCompatibility.report.overallScore < 80) {
      score -= 20;
      issues.push('Browser compatibility issues detected');
    }

    // Network connectivity (basic check)
    if (navigator.onLine === false) {
      score -= 50;
      issues.push('Network connectivity issues');
    }

    return { score: Math.max(0, score), issues };
  }, [
    sessionValidation.result,
    sessionPersistence.hasValidationError,
    browserCompatibility.report,
  ]);

  useEffect(() => {
    if (enabled) {
      const { score } = calculateHealthScore();

      const isHealthy = score >= 70;
      if (onHealthChange) {
        onHealthChange(isHealthy);
      }
    }
  }, [calculateHealthScore, enabled, onHealthChange]);

  const { score: currentScore, issues } = calculateHealthScore();

  const getHealthStatus = () => {
    if (currentScore >= 90)
      return { status: 'excellent', color: 'text-green-600', icon: CheckCircle };
    if (currentScore >= 70) return { status: 'good', color: 'text-blue-600', icon: Wifi };
    if (currentScore >= 50)
      return { status: 'fair', color: 'text-yellow-600', icon: AlertTriangle };
    return { status: 'poor', color: 'text-red-600', icon: WifiOff };
  };

  const healthStatus = getHealthStatus();
  const StatusIcon = healthStatus.icon;

  if (!enabled) return null;

  if (!showUI) {
    // Background monitoring only
    return null;
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <StatusIcon className={`h-5 w-5 ${healthStatus.color}`} />
          Session Health
        </CardTitle>
        <CardDescription>Real-time monitoring of your authentication session</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Health Score */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Health Score</span>
            <span className={`font-semibold ${healthStatus.color}`}>{currentScore}%</span>
          </div>
          <Progress
            value={currentScore}
            className="h-2"
            // Custom color based on health
          />
          <p className={`text-sm capitalize ${healthStatus.color}`}>
            Status: {healthStatus.status}
          </p>
        </div>

        {/* Last Check */}
        {lastHealthCheck && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            Last checked: {lastHealthCheck.toLocaleTimeString()}
          </div>
        )}

        {/* Issues */}
        {issues.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-orange-600">Issues detected:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {issues.map((issue) => (
                <li key={issue} className="flex items-start gap-2">
                  <span className="text-orange-500 mt-1">•</span>
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Validations</p>
            <p className="font-semibold">{sessionValidation.validationCount}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Retries</p>
            <p className="font-semibold">{sessionValidation.retryCount}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sessionValidation.validate(true)}
            disabled={sessionValidation.isValidating || isRecovering}
            className="flex-1"
          >
            {sessionValidation.isValidating ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Checking...
              </>
            ) : (
              'Check Now'
            )}
          </Button>

          {currentScore < 70 && (
            <Button
              size="sm"
              onClick={handleSessionRecovery}
              disabled={isRecovering || sessionValidation.isValidating}
              className="flex-1"
            >
              {isRecovering ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Recovering...
                </>
              ) : (
                'Recover'
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
