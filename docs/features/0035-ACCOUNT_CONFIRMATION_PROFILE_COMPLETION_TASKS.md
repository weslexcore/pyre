## Relevant Files

- `apps/booking-system/components/sign-up-form.tsx` - Update signup form to handle email confirmation flow properly
- `apps/booking-system/app/auth/sign-up-success/page.tsx` - Update success page messaging and add resend functionality
- `apps/booking-system/app/auth/confirm/route.ts` - Email confirmation route handler (already exists)
- `apps/booking-system/app/complete-profile/page.tsx` - New profile completion form page
- `apps/booking-system/app/complete-profile/page.test.tsx` - Unit tests for profile completion page
- `apps/booking-system/components/complete-profile-form.tsx` - Profile completion form component
- `apps/booking-system/components/complete-profile-form.test.tsx` - Unit tests for profile completion form
- `apps/booking-system/components/profile-completion-modal.tsx` - Blocking modal for incomplete profiles
- `apps/booking-system/components/profile-completion-modal.test.tsx` - Unit tests for profile completion modal
- `apps/booking-system/lib/supabase/middleware.ts` - Update middleware to check email confirmation and profile completion
- `apps/booking-system/middleware.ts` - Update route matcher to allow schedule access for unconfirmed users
- `apps/booking-system/components/account-form.tsx` - Update to include first name, last name, and date of birth fields
- `apps/booking-system/lib/supabase/queries.ts` - Add profile completion check functions
- `apps/booking-system/lib/supabase/client-queries.ts` - Add client-side profile update functions
- `apps/booking-system/lib/utils/profile.ts` - Utility functions for profile completion validation
- `apps/booking-system/lib/utils/profile.test.ts` - Unit tests for profile utilities

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `MyComponent.tsx` and `MyComponent.test.tsx` in the same directory).
- Use `yarn test [optional/path/to/test/file]` to run tests. Running without a path executes all tests found by the Jest configuration.
- User profile data will be stored in `auth.users.raw_user_meta_data` rather than separate database tables.
- Schedule page remains accessible to all users; only protected features require email confirmation and profile completion.
- Jest testing framework has been configured and is ready for use with React Testing Library.

## Tasks

- [x] 1.0 Email Confirmation System Enhancement
  - [x] 1.1 Configure Supabase email confirmation settings and templates in dashboard
  - [x] 1.2 Update SignUpForm to properly handle email confirmation flow and redirect to sign-up-success
  - [x] 1.3 Enhance sign-up-success page with improved messaging and resend confirmation functionality
  - [x] 1.4 Update middleware to prevent login access for unconfirmed email addresses
- [x] 2.0 Profile Data Management Using User Metadata
  - [x] 2.1 Create utility functions for reading/writing profile data from auth.users.raw_user_meta_data
  - [x] 2.2 Add profile completion validation logic (check for first_name, last_name, date_of_birth)
  - [x] 2.3 Update existing account form to work with user metadata instead of separate fields
  - [x] 2.4 Create server-side profile queries for checking completion status
- [x] 3.0 Complete Profile Page Implementation
  - [x] 3.1 Create `/complete-profile` page with form layout matching existing auth pages
  - [x] 3.2 Build CompleteProfileForm component with first name, last name, and date of birth fields
  - [x] 3.3 Add form validation, privacy messaging, and submission handling
  - [x] 3.4 Implement redirect to schedule page after successful profile completion
- [x] 4.0 Profile Completion Enforcement System
  - [x] 4.1 Update middleware to allow schedule access but restrict protected routes based on email confirmation and profile completion
  - [x] 4.2 Create ProfileCompletionModal component for blocking incomplete profiles
  - [x] 4.3 Add profile completion checks to protected routes (account, booking, admin)
  - [x] 4.4 Update route protection logic to differentiate between email confirmation and profile completion requirements
- [x] 5.0 Profile Management Integration
  - [x] 5.1 Update AccountForm component to include first name, last name, and date of birth fields
  - [x] 5.2 Modify profile update functionality to work with user metadata
  - [x] 5.3 Ensure consistent validation rules between complete-profile and account pages
  - [x] 5.4 Update account page layout to accommodate additional profile fields