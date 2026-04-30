'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';

interface HealthCheck {
  service: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
  latency?: number;
  details?: string;
}

interface HealthData {
  status: 'healthy' | 'unhealthy' | 'degraded';
  totalLatencyMs: number;
  timestamp: string;
  environment: string;
  checks: HealthCheck[];
}

const STATUS_ICON: Record<string, React.ElementType> = {
  ok: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

const STATUS_COLOR: Record<string, string> = {
  ok: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
};

const STATUS_BG: Record<string, string> = {
  ok: 'bg-emerald-500/10 border-emerald-500/20',
  error: 'bg-red-500/10 border-red-500/20',
  warning: 'bg-amber-500/10 border-amber-500/20',
};

const OVERALL_COLOR: Record<string, string> = {
  healthy: 'text-emerald-400',
  unhealthy: 'text-red-400',
  degraded: 'text-amber-400',
};

export function HealthCheckBar() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const resp = await fetch('/api/health');
      if (!resp.ok) throw new Error('Health check failed');
      const json = await resp.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-3 px-4">
        <Loader2 className="w-3 h-3 text-zinc-500 animate-spin" />
        <span className="text-xs text-zinc-500">Checking services...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-3 px-4">
        <XCircle className="w-3 h-3 text-red-400" />
        <span className="text-xs text-red-400">Services unreachable</span>
        <button onClick={fetchHealth} className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-300 ml-2">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Summary Bar */}
      <div
        className="flex items-center justify-center gap-2 py-3 px-4 cursor-pointer hover:bg-zinc-800/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <Activity className={`w-3.5 h-3.5 ${OVERALL_COLOR[data.status]}`} />
        <span className={`text-xs font-medium ${OVERALL_COLOR[data.status]}`}>
          {data.status === 'healthy' ? 'All Systems Operational' :
           data.status === 'degraded' ? 'Partial Service Available' : 'Service Issues Detected'}
        </span>
        <span className="text-xs text-zinc-600">({data.totalLatencyMs}ms)</span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-zinc-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-zinc-500" />
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-zinc-800/50 px-4 py-3">
          <div className="max-w-lg mx-auto space-y-2">
            {data.checks.map((check) => {
              const Icon = STATUS_ICON[check.status] || AlertTriangle;
              return (
                <div
                  key={check.service}
                  className={`flex items-start gap-3 p-2.5 rounded-lg border ${STATUS_BG[check.status] || 'bg-zinc-800/50 border-zinc-700/50'}`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${STATUS_COLOR[check.status]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-zinc-200">{check.service}</p>
                      {check.latency !== undefined && (
                        <span className="text-xs text-zinc-500 shrink-0">{check.latency}ms</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">{check.message}</p>
                    {check.details && (
                      <p className="text-xs text-zinc-500 mt-1 line-clamp-2 font-mono">{check.details}</p>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-zinc-600 text-center pt-1">
              Last checked: {new Date(data.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
