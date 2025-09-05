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

### Authentication Flow
- Uses Supabase SSR authentication with cookie-based sessions
- Middleware (`middleware.ts`) handles session management and protects routes
- Three Supabase client configurations:
  - `lib/supabase/client.ts` - Browser client for client components
  - `lib/supabase/server.ts` - Server client for server components/actions
  - `lib/supabase/middleware.ts` - Middleware client for route protection
- Protected routes automatically redirect to `/auth/login` if unauthenticated

### Project Structure
- `app/` - Next.js App Router pages and layouts
  - `auth/` - Authentication pages (login, signup, password reset)
  - `protected/` - Protected pages requiring authentication
- `components/` - React components
  - `ui/` - shadcn/ui components
  - `tutorial/` - Tutorial step components
- `lib/` - Utility functions and Supabase configuration

### Component System
- Uses shadcn/ui with CSS variables for theming
- Dark/light mode support via next-themes
- Import aliases configured: `@/components`, `@/lib`, `@/ui`

### Environment Variables Required
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY` - Supabase anon key

### Styling Approach
- Tailwind CSS with custom CSS variables
- Uses Geist font family
- Responsive design patterns
- shadcn/ui component styling conventions

## Important Implementation Notes

- Always create new Supabase server clients within functions (don't use globals)
- Middleware redirects unauthenticated users from protected routes
- The app handles missing environment variables gracefully during development
- Uses `hasEnvVars` utility to check environment setup before running auth flows