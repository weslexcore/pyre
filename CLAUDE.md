# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

This is a Turborepo monorepo with Yarn workspaces containing multiple applications focused on the Pyre sauna business. The project uses Node.js 22 LTS and Yarn 4.9.4 as the package manager.

### Applications Structure

- **apps/booking-system/**: Next.js 15 booking application with Supabase authentication
- **apps/landing-page/**: Astro 5 marketing website with Tailwind CSS v4
- **apps/supabase/**: Database configuration, migrations, and Supabase CLI tools

### Core Technologies
- **Monorepo**: Turborepo for build orchestration and workspace management
- **Package Manager**: Yarn 4.9.4 (configured via Corepack)
- **Node.js**: Version 22 LTS (specified in root .nvmrc)
- **TypeScript**: Used across all applications
- **Database**: Supabase (PostgreSQL) with migrations and RLS policies

## Development Commands

### Root-level commands (run from monorepo root):
- `yarn dev` - Start all applications in development mode
- `yarn build` - Build all applications for production
- `yarn lint` - Run linting across all workspaces
- `yarn lint:fix` - Fix linting issues across all workspaces  
- `yarn format` - Format code across all workspaces
- `yarn check` - Run checks across all workspaces
- `yarn check:fix` - Fix checks across all workspaces
- `yarn type-check` - Run TypeScript checking across all workspaces

### Individual workspace commands (alternative syntax):
```bash
# Alternative shorter syntax for specific workspaces:
yarn dev:booking    # Start booking system only
yarn dev:landing    # Start landing page only  
yarn dev:supabase   # Start Supabase only
yarn build:booking  # Build booking system
yarn build:landing  # Build landing page
yarn lint:booking   # Lint booking system
yarn lint:landing   # Lint landing page
yarn format:booking # Format booking system
yarn format:landing # Format landing page
yarn check:booking  # Check booking system
yarn check:landing  # Check landing page
yarn type-check:booking  # TypeScript check booking system
yarn type-check:landing  # TypeScript check landing page
```

### Workspace-specific commands:
```bash
# Booking System (Next.js)
yarn workspace @pyre/booking-system dev
yarn workspace @pyre/booking-system build
yarn workspace @pyre/booking-system lint

# Landing Page (Astro)
yarn workspace @pyre/landing-page dev  
yarn workspace @pyre/landing-page build
yarn workspace @pyre/landing-page format

# Supabase (Database)
yarn workspace @pyre/supabase start
yarn workspace @pyre/supabase stop
yarn workspace @pyre/supabase status
yarn workspace @pyre/supabase reset
yarn workspace @pyre/supabase gen:types
yarn workspace @pyre/supabase migrate
yarn workspace @pyre/supabase db:diff
yarn workspace @pyre/supabase db:push
yarn workspace @pyre/supabase seed
```

## Booking System Architecture

Next.js 15 application using App Router with Supabase authentication.

### Key Features
- **Next.js 15** with App Router and React 19
- **Supabase** authentication with SSR support (@supabase/ssr)
- **shadcn/ui** components with Tailwind CSS
- **TypeScript** for type safety
- **React Query** (@tanstack/react-query) for data fetching

### Authentication & Database
- Cookie-based sessions with middleware protection
- Three Supabase client configurations:
  - `lib/supabase/client.ts` - Browser client
  - `lib/supabase/server.ts` - Server client (always create new instances)
  - `lib/supabase/middleware.ts` - Middleware client
- Database schema includes locations, offerings, and bookings tables
- Row Level Security (RLS) policies implemented

### Project Structure
```
apps/booking-system/
├── app/                    # Next.js App Router pages
│   ├── auth/              # Authentication pages (login, sign-up, etc.)
│   ├── protected/         # Protected routes requiring authentication
│   ├── admin/             # Admin interface (locations, offerings)
│   ├── schedule/          # Public schedule display
│   ├── account/           # User account management
│   └── unauthorized/      # Access denied page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   └── providers/        # Context providers
├── lib/                   # Utilities and configurations
│   └── supabase/         # Supabase client configurations and queries
└── hooks/                 # Custom React hooks
```

## Landing Page Architecture

Astro 5 static site with Tailwind CSS v4 for fast, performance-focused marketing.

### Key Features
- **Astro 5** with component islands architecture
- **Tailwind CSS v4** via @tailwindcss/vite (no DaisyUI)
- **React islands** for interactive components
- **Sharp** for image optimization
- **Biome** for linting and formatting

### Content Management & Development Workflow
- Copy/configuration centralized in `src/lib/*.ts` files (follows "012-copy-configs" rule)
- Assets organized in `public/` (fonts, images, logos, symbols)  
- Styling in `src/styles/global.css` with Tailwind-first approach

### Project Structure
```
apps/landing-page/
├── src/
│   ├── components/        # Astro and React components
│   ├── layouts/          # Astro layouts
│   ├── pages/            # Astro pages and routes
│   ├── lib/              # Content configuration files
│   └── styles/           # Global CSS
├── public/               # Static assets
```

## Database Management

All database operations are managed through the Supabase workspace.

### Migration Guidelines
- All database migrations go into `apps/supabase/migrations/`
- Migration files must follow naming convention: `YYYYMMDDHHmmss_description.sql`
- Always include RLS policies when creating tables
- Use lowercase SQL with comprehensive comments
- Generate TypeScript types: `yarn workspace @pyre/supabase gen:types`

### Key Database Tables
- **locations**: Sauna locations with address and active status
- **offerings**: Services offered at locations with pricing, duration, and slot management (has available_slots)
- **bookings**: User bookings with session details and status (linked to offerings and users)
- **schedule** (VIEW): Public view combining offerings with location information for display

### Session Types and Business Logic
- **Session Types**: Social, Silent, Guided with different pricing and capacity
- **Slot Management**: Real-time availability tracking via available_slots field
- **Location-based Pricing**: Different pricing tiers based on location and session type
- **Admin Detection**: Uses `raw_user_meta_data->>'role' = 'admin'` for admin privileges

### RLS (Row Level Security) Implementation
- **Granular policies** for each table and operation (SELECT, INSERT, UPDATE, DELETE)
- **Admin detection** via `is_admin()` function checking user metadata
- **Public access** to active locations and their offerings
- **User isolation** for bookings (users can only see/modify their own bookings)
- **Schedule view** for public display of offerings with location information

## Development Setup

### Node.js Version Management
- **CRITICAL**: Always use Node.js 22 LTS (specified in root .nvmrc)
- Run `nvm use` when starting development
- Enable Corepack: `corepack enable`

### Installation
```bash
# 1. Switch to correct Node version
nvm use

# 2. Enable Corepack for Yarn 4
corepack enable

# 3. Install dependencies
yarn install --immutable

# 4. Start development
yarn dev
```

### Environment Variables
Booking system requires:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Landing page uses:
- `ASTRO_SITE` - Site URL for production (optional)
- `ASTRO_BASE` - Base path for assets (defaults to "/pyre" for GitHub Pages)

## Code Conventions

### General Guidelines
- Follow existing patterns and conventions in each workspace
- Use TypeScript strictly across all applications
- Prefer composition over inheritance
- Write clean, readable code with proper error handling

### Styling Conventions
- **Booking System**: shadcn/ui with CSS variables for theming
- **Landing Page**: Tailwind CSS v4 utility-first approach
- Follow mobile-first responsive design patterns
- Use semantic HTML elements for accessibility

### Component Guidelines
- Create reusable components following existing patterns
- Use proper TypeScript types for all props and functions
- Implement proper error boundaries and loading states
- Follow accessibility best practices

## Important Rules from .cursor/rules

### Package Manager
- Always use `yarn` (not npm) as the package manager
- Use `yarn add` instead of `npm install`

### Database Migrations  
- Store all copy in `src/lib/*.ts` configuration files (landing-page)
- Avoid hardcoding copy in components
- Create granular RLS policies (separate for each operation and role)
- Include comprehensive comments in migration files

### Tech Stack Guidelines
- Use Node.js 22 specified in `.nvmrc`
- Follow Astro's zero-JS by default philosophy for landing page
- Leverage Next.js App Router patterns for booking system
- Create proper TypeScript interfaces and types

### Landing Page Development Workflow
- Follow structured development commands in `apps/landing-page/docs/commands/`
- Create briefs before implementing features using `create_brief.md`
- Plan features and bugfixes using dedicated planning commands
- Store documentation in organized `docs/` structure

## Testing and Quality

### Linting and Formatting
- **Booking System**: ESLint (Next.js) and Biome for linting; Biome available for formatting
- **Landing Page**: Biome for linting and formatting
- Run quality checks: `yarn lint` and `yarn format`

### Type Checking
- Run TypeScript checks: `yarn type-check`
- Generate database types: `yarn workspace @pyre/supabase gen:types`
- Ensure type safety across all workspaces
