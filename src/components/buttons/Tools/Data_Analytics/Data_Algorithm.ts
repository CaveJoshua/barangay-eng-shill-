// ─── Forecasting Algorithms ──────────────────────────────────────────────────

/**
 * Holt's Double Exponential Smoothing (Linear Trend)
 * Used for time series forecasting with trend component
 * 
 * @param values - Array of historical values
 * @param alpha - Level smoothing parameter (0-1, default: 0.35)
 * @param beta - Trend smoothing parameter (0-1, default: 0.15)
 * @returns Object with forecast function, trend, and level
 */
export const holts = (values: number[], alpha = 0.35, beta = 0.15) => {
  const n = values.length;
  
  // Handle edge cases
  if (n === 0) return { forecast: (_h: number) => 0, trend: 0, level: 0 };
  if (n === 1) return { forecast: (_h: number) => values[0], trend: 0, level: values[0] };

  // Initialize level and trend
  let level = values[0];
  let trend = values[1] - values[0];

  // Apply Holt's smoothing iteratively
  for (let i = 1; i < n; i++) {
    const lPrev = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - lPrev) + (1 - beta) * trend;
  }

  return {
    /**
     * Forecast h steps ahead
     * @param h - Number of time steps to forecast
     * @returns Forecasted value (rounded, non-negative)
     */
    forecast: (h: number) => Math.max(0, Math.round(level + h * trend)),
    trend,
    level,
  };
};