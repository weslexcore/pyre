import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasEnvVars } from '../utils';
import { isProfileComplete } from '../utils/profile';
import { getRouteAccessInfo } from '../utils/route-protection';

// Cache for route access info to avoid repeated config lookups
interface CachedRouteInfo {
  data: ReturnType<typeof getRouteAccessInfo>;
  timestamp: number;
}

const routeInfoCache = new Map<string, CachedRouteInfo>();

// Performance optimization: Cache route access info for 1 minute
const ROUTE_CACHE_TTL = 60 * 1000;

function getCachedRouteInfo(pathname: string) {
  const cached = routeInfoCache.get(pathname);
  if (cached && Date.now() - cached.timestamp < ROUTE_CACHE_TTL) {
    return cached.data;
  }

  const routeInfo = getRouteAccessInfo(pathname);
  routeInfoCache.set(pathname, {
    data: routeInfo,
    timestamp: Date.now(),
  });

  return routeInfo;
}

export async function updateSession(request: NextRequest) {
  // Early exit for public assets and API routes to improve performance
  const pathname = request.nextUrl.pathname;
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/') ||
    (pathname.includes('.') && !pathname.includes('/auth/'))
  ) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip middleware check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Optimized cookie handling with batch operations
          const cookieUpdates = new Map();

          // Batch cookie updates to avoid multiple response object creations
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
            cookieUpdates.set(name, { value, options: undefined });
          });

          supabaseResponse = NextResponse.next({ request });

          // Apply all cookie updates in one batch
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Align cookie policy with client-managed session cookies
              httpOnly: options?.httpOnly ?? false,
              secure: options?.secure ?? process.env.NODE_ENV === 'production',
              sameSite: options?.sameSite ?? 'lax',
            });
          });
        },
      },
    }
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.

  try {
    // Parallel execution of auth operations for better performance
    const [claimsResult, userResult] = await Promise.all([
      supabase.auth.getClaims(),
      supabase.auth.getUser(),
    ]);

    const { data } = claimsResult;
    const user = data?.claims;
    const {
      data: { user: fullUser },
    } = userResult;

    // Get route access requirements based on configuration (with caching)
    const routeInfo = getCachedRouteInfo(pathname);

    // Public routes - no protection needed
    if (routeInfo.isPublic) {
      return supabaseResponse;
    }

    // All non-public routes require authentication
    if (!user && routeInfo.requiresAuth) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/login';
      return NextResponse.redirect(url);
    }

    // Routes requiring email confirmation
    if (user && fullUser && routeInfo.requiresEmailConfirmation && !fullUser.email_confirmed_at) {
      const url = request.nextUrl.clone();
      url.pathname = '/unauthorized';
      url.searchParams.set('reason', 'email_confirmation_required');
      return NextResponse.redirect(url);
    }

    // Routes requiring profile completion
    if (user && fullUser && routeInfo.requiresProfileCompletion && !isProfileComplete(fullUser)) {
      const url = request.nextUrl.clone();
      url.pathname = '/complete-profile';
      return NextResponse.redirect(url);
    }

    // Admin routes require special handling
    if (user && fullUser && routeInfo.requiresAdminAccess) {
      const isAdmin = fullUser?.user_metadata?.is_super_admin === true;
      if (!isAdmin) {
        const url = request.nextUrl.clone();
        url.pathname = '/unauthorized';
        url.searchParams.set('reason', 'admin_required');
        return NextResponse.redirect(url);
      }
    }
  } catch (error) {
    // Log auth errors for debugging but don't block the request
    console.warn('Auth middleware error:', error);

    // For auth errors, redirect to login unless it's a public route
    const routeInfo = getCachedRouteInfo(pathname);
    if (!routeInfo.isPublic) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/login';
      return NextResponse.redirect(url);
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
