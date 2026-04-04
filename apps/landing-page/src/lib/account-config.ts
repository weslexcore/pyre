// Account page copy and configuration
// Following the centralized config pattern from other lib files

export const accountConfig = {
  page: {
    title: 'My Account | Pyre Sauna',
    description:
      'Manage your Pyre Sauna account, view upcoming sessions, and check your membership status.',
  },
  dashboard: {
    title: 'Welcome back',
    subtitle: 'Manage your account and bookings',
  },
  profile: {
    title: 'Profile',
    emailLabel: 'Email',
    phoneLabel: 'Phone',
    editButton: 'Edit Profile',
    getManageUrl: (userId: number) => `https://momence.com/dashboard/u/${userId}/user-profile`,
    addPhoneLink: '+ Add phone number',
    phoneInput: {
      label: 'Phone Number',
      placeholder: '(555) 123-4567',
      helpText: 'Your phone number for booking confirmations',
    },
    saveButton: 'Save',
    cancelButton: 'Cancel',
    saving: 'Saving...',
    success: 'Profile updated successfully',
    errors: {
      invalidPhone: 'Please enter a valid phone number (7-20 digits)',
      updateFailed: 'Failed to update profile. Please try again.',
    },
  },
  sessions: {
    title: 'Upcoming Sessions',
    manageButton: 'Manage Sessions',
    getManageUrl: (userId: number) => `https://momence.com/dashboard/u/${userId}/my-events`,
    emptyState: 'No upcoming sessions',
    emptyStateAction: 'Book Your Next Session',
    cancelButton: 'Cancel',
    cancelConfirm: 'Are you sure you want to cancel this booking?',
    viewAllButton: 'View All Sessions',
  },
  attendedSessions: {
    title: 'Session History',
    emptyState: 'No past sessions yet',
    statusLabels: {
      attended: 'Attended',
      missed: 'Missed',
    },
  },
  membership: {
    title: 'Membership',
    emptyState: 'No active membership',
    emptyStateSubtitle: 'Join Pyre to unlock exclusive benefits',
    emptyStateAction: 'View Membership Options',
    renewalLabel: 'Renews on',
    sessionsLabel: 'Sessions remaining',
    unlimitedLabel: 'Unlimited',
    creditsLabel: 'Available Credits',
    // singleSessionLink: 'Or browse single sessions',
    upgradePrompt: 'Upgrade to a membership for more value',
    benefitsLabel: 'Your Benefits',
    manageButton: 'Manage Membership',
    getManageUrl: (userId: number) => `https://momence.com/dashboard/u/${userId}/my-memberships`,
  },
  credits: {
    title: 'Available Credits',
    emptyState: 'No credits available',
    emptyStateSubtitle: 'Purchase a session pack to get started',
    sourceLabel: 'From',
    expiresLabel: 'Expires',
    packsHeading: 'Session Packs',
  },
  errors: {
    authFailed: 'Authentication failed. Please try again.',
    stateMismatch: 'Security check failed. Please try logging in again.',
    tokenExchangeFailed: 'Failed to complete login. Please try again.',
    generic: 'Something went wrong. Please try again.',
  },
  loginPrompt: {
    title: 'Sign in to your account',
    subtitle: 'Access your bookings, membership, and more',
    loginButton: 'Login',
    signupButton: 'Create Account',
    signupPrompt: "Don't have an account?",
  },
  dropdown: {
    accountLabel: 'Account',
    sessionsLabel: 'My Sessions',
    logoutLabel: 'Sign Out',
  },
};

export type AccountConfig = typeof accountConfig;
