# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `yarn dev` - Start development server with Turbopack
- `yarn build` - Build the application for production
- `yarn start` - Start production server
- `yarn lint` - Run ESLint to check code quality

## Project Architecture

This is a Next.js 15 application using the App Router with Supabase authentication and shadcn/ui components.

### Key Technologies
- **Next.js 15** with App Router and React 19
- **Supabase** for authentication and database (using @supabase/ssr)
- **TypeScript** for type safety
- **Tailwind CSS** for styling with shadcn/ui components
- **shadcn/ui** component library (New York style variant)
- **React Query** (@tanstack/react-query) for data fetching

### Authentication Flow
- Uses Supabase SSR authentication with cookie-based sessions
- Middleware (`middleware.ts`) handles session management and protects routes
- Three Supabase client configurations:
  - `lib/supabase/client.ts` - Browser client for client components
  - `lib/supabase/server.ts` - Server client for server components/actions
  - `lib/supabase/middleware.ts` - Middleware client for route protection
- Protected routes automatically redirect to `/auth/login` if unauthenticated

### Database Schema
Core entities include:
- **locations**: Sauna locations with address and active status
- **offerings**: Services offered at locations with pricing, duration, and availability
- **bookings**: User bookings with session details and status tracking

### Admin System
- Admin access controlled by `is_super_admin` flag in user metadata
- Admin layout (`app/admin/layout.tsx`) provides navigation and access control
- Admin routes for locations and offerings management

### Project Structure
- `app/` - Next.js App Router pages and layouts
  - `auth/` - Authentication pages (login, signup, password reset)
  - `protected/` - Protected pages requiring authentication
  - `admin/` - Admin interface with role-based access
- `components/` - React components
  - `ui/` - shadcn/ui components
  - `tutorial/` - Tutorial step components
  - `admin/` - Admin-specific components
- `lib/` - Utility functions and Supabase configuration
  - `supabase/` - Supabase client configurations and queries
  - `database.types.ts` - TypeScript interfaces for database entities

### Component System
- Uses shadcn/ui with CSS variables for theming
- Dark/light mode support via next-themes
- Import aliases configured: `@/components`, `@/lib`, `@/ui`, `@/hooks`
- Custom Pyre brand fonts loaded via Next.js localFont

### Environment Variables Required
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key

### Styling Approach
- Tailwind CSS with custom CSS variables
- Custom Pyre brand fonts (Eckmannpsych, PP Neue Montreal, PP Fraktion Mono)
- Responsive design patterns
- shadcn/ui component styling conventions with New York variant

## Important Implementation Notes

- Always create new Supabase server clients within functions (don't use globals)
- Middleware redirects unauthenticated users from protected routes
- The app handles missing environment variables gracefully during development
- Uses `hasEnvVars` utility to check environment setup before running auth flows
- Admin routes require both authentication and super admin privileges
- Database types are defined in `lib/database.types.ts` with proper TypeScript interfaces
- Use nvm and .nvmrc for node versioning