# Pyre Booking System - Supabase Setup

This directory contains the Supabase configuration, migrations, and seed data for the Pyre booking system.

## Quick Start

**Important**: Make sure you're in the `/Users/wes/Documents/pyre/apps` directory when running Supabase commands.

1. **Install Supabase CLI** (if not already installed):
   ```bash
   npm install -g supabase
   ```

2. **Navigate to the correct directory**:
   ```bash
   cd /Users/wes/Documents/pyre/apps
   ```

3. **Start local Supabase**:
   ```bash
   supabase start
   ```

4. **Apply migrations and seed data**:
   ```bash
   supabase db reset
   ```

5. **Generate TypeScript types**:
   ```bash
   supabase gen types typescript --local > booking-system/lib/database.types.ts
   ```

## Troubleshooting

### Migration Conflicts
If you encounter constraint or trigger conflicts, the migrations have been updated to handle these automatically with:
- `DROP TABLE IF EXISTS` statements for clean table recreation
- `DROP TRIGGER IF EXISTS` statements to avoid trigger conflicts
- `DROP POLICY IF EXISTS` statements to avoid RLS policy conflicts
- Renamed constraints to avoid naming conflicts (e.g., `offerings_slots_constraint`)

### Public Access
The schedule page (`/schedule`) is accessible without authentication:
- **Middleware**: Updated to allow public access to `/schedule` routes
- **RLS Policies**: Allow anonymous users to view active locations and offerings
- **Public Queries**: Separate query functions for anonymous access (`lib/supabase/public-queries.ts`)
- **Past Session Filtering**: Automatically excludes past sessions using date/time comparison

Anonymous users can browse upcoming sessions but cannot make bookings.

### Session Filtering
- **Public Schedule**: Only shows upcoming sessions (past sessions automatically excluded)
- **Admin Panel**: Shows all sessions including past ones (useful for historical data)
- **Logic**: Filters sessions where `date > today OR (date = today AND time > current_time)`
- **Timezone**: Currently uses server local time (consider business timezone for production)

### Infinite Query Implementation
The schedule uses Supabase's infinite query hook for optimal performance:
- **Progressive Loading**: Loads ~14 days of sessions per page (approximately 2 weeks)
- **Client-side Caching**: React Query handles caching and stale data management
- **Real-time Filtering**: Filter by location, session type, and date range without full refetch
- **Load More UX**: Manual "Load More" button for user control
- **Performance**: Only fetches data as needed, reducing initial load time

## Database Schema

### Tables Created

1. **locations**: Store business locations
   - `id` (UUID, primary key)
   - `name` (TEXT) - Location name
   - `address` (TEXT) - Full address
   - `active` (BOOLEAN) - Whether location is visible to customers
   - `created_at`, `updated_at` (TIMESTAMP)

2. **offerings**: Store session offerings
   - `id` (UUID, primary key)
   - `date` (DATE) - Session date
   - `time` (TIME) - Session time
   - `session_type` (TEXT) - "Sauna", "Cold Plunge", or "Sauna + Cold Plunge Combo"
   - `location_id` (UUID) - Foreign key to locations
   - `cost` (DECIMAL) - Session price
   - `total_slots` (INTEGER) - Maximum capacity
   - `available_slots` (INTEGER) - Current available slots
   - `created_at`, `updated_at` (TIMESTAMP)

3. **bookings**: Store customer bookings
   - `id` (UUID, primary key)
   - `user_id` (UUID) - Foreign key to auth.users
   - `offering_id` (UUID) - Foreign key to offerings
   - `booking_date` (TIMESTAMP) - When booking was made
   - `status` (TEXT) - "confirmed", "cancelled", or "no-show"
   - `created_at`, `updated_at` (TIMESTAMP)

### Security (Row Level Security)

- **Locations**: Public can view active locations, admins can manage all
- **Offerings**: Public can view offerings for active locations, admins can manage all
- **Bookings**: Users can view/manage their own bookings, admins can view all

### Automatic Features

- **Slot Management**: Available slots automatically decrease when bookings are made
- **Data Integrity**: Constraints ensure available_slots ≤ total_slots
- **Audit Trail**: All tables have created_at and updated_at timestamps

## Available Scripts

- `npm run start` - Start local Supabase instance
- `npm run stop` - Stop local Supabase instance
- `npm run status` - Check Supabase status
- `npm run reset` - Reset database with fresh migrations and seed data
- `npm run migrate <name>` - Create a new migration
- `npm run migration:up` - Apply pending migrations
- `npm run db:diff` - Generate migration from schema changes
- `npm run gen:types` - Generate TypeScript types for the booking system
- `npm run link` - Link to remote Supabase project
- `npm run login` - Login to Supabase CLI

## Seed Data

The system includes sample data:
- 4 locations (3 active, 1 inactive)
- Multiple offerings across different locations and dates
- Various session types and pricing

## Production Setup

1. Create a Supabase project at https://supabase.com
2. Link your local project: `npm run link`
3. Push migrations: `npm run db:push`
4. Set environment variables in your Next.js app:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Admin Access

Currently, admin access is granted to any authenticated user. In production, you should:

1. Update the `is_admin` function in the RLS policies migration
2. Add proper role checking (user metadata, JWT claims, or admin table)
3. Implement proper authentication guards

## Monitoring

Use Supabase Studio (http://localhost:54323 when running locally) to:
- View and edit data
- Monitor query performance
- Manage users and auth
- View logs and analytics