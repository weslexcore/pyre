// Human wording for the error codes the campaign routes return. Client-safe.

export function campaignErrorMessage(code: unknown, fallback = 'Something went wrong.'): string {
  switch (code) {
    case 'slug_taken':
      return 'A campaign with this name already exists.';
    case 'duplicate_placement':
      return 'This placement already has a link. Add a variant to make another.';
    case 'alias_taken':
      return 'That short link is already taken.';
    case 'storage_unavailable':
      return 'Link storage is unavailable right now.';
    case 'invalid_destination':
      return 'That destination is not a valid web address.';
    case 'slug_immutable':
      return 'The campaign slug cannot change once links exist.';
    case 'not_found':
      return 'That campaign no longer exists.';
    default:
      return typeof code === 'string' && code ? code : fallback;
  }
}
