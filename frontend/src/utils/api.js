/**
 * API Configuration Utility
 * 
 * Determines the correct API base URL based on environment:
 * - If VITE_API_URL is set, use it (for explicit configuration)
 * - Otherwise, use relative path /api (works with Vercel rewrites and local dev proxy)
 * 
 * This ensures:
 * - Vercel deployments use /api which is proxied to backend via vercel.json
 * - Local development uses /api which is proxied via vite.config.js
 * - Explicit VITE_API_URL overrides for custom configurations
 */

export const getApiBase = () => {
  const envApiUrl = import.meta.env.VITE_API_URL
  
  // If explicitly set, use it
  if (envApiUrl) {
    return envApiUrl
  }
  
  // Default to relative path - works with:
  // 1. Vercel rewrites (vercel.json proxies /api/* to backend)
  // 2. Vite dev server proxy (vite.config.js proxies /api to backend)
  // 3. Same-origin requests in production
  return '/api'
}

export const API_BASE = getApiBase()
