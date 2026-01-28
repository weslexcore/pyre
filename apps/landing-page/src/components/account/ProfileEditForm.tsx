// ProfileEditForm component
// Inline form for editing profile fields (phone)

import { useState } from 'react';
import { accountConfig } from '@/lib/account-config';
import { useUpdateProfile } from '@/hooks/useUpdateProfile';

interface ProfileEditFormProps {
  initialPhone: string;
  onSave: (phone: string) => void;
  onCancel: () => void;
}

export function ProfileEditForm({
  initialPhone,
  onSave,
  onCancel,
}: ProfileEditFormProps) {
  const [phone, setPhone] = useState(initialPhone);
  const { updateProfile, loading, error } = useUpdateProfile();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const success = await updateProfile({ phone: phone.trim() });
    if (success) {
      onSave(phone.trim());
    }
  };

  const getErrorMessage = (err: string): string => {
    if (err === 'invalid_phone') {
      return accountConfig.profile.errors.invalidPhone;
    }
    return accountConfig.profile.errors.updateFailed;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="phone"
          className="block font-mono-bold uppercase text-xs mb-1"
        >
          {accountConfig.profile.phoneInput.label}
        </label>
        <input
          type="tel"
          id="phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={accountConfig.profile.phoneInput.placeholder}
          className="w-full px-3 py-2 bg-[var(--pyre-creme)]/10 border border-[var(--pyre-creme)]/20 rounded text-[var(--pyre-creme)] placeholder:text-[var(--pyre-creme)]/40 focus:outline-none focus:border-[var(--pyre-blue)]"
          disabled={loading}
        />
        <p className="mt-1 text-xs opacity-60">
          {accountConfig.profile.phoneInput.helpText}
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-400">{getErrorMessage(error)}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-[var(--pyre-blue)] text-[var(--pyre-creme)] font-mono-bold uppercase text-sm rounded hover:bg-[var(--pyre-blue)]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? accountConfig.profile.saving : accountConfig.profile.saveButton}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 bg-transparent border border-[var(--pyre-creme)]/30 text-[var(--pyre-creme)] font-mono-bold uppercase text-sm rounded hover:border-[var(--pyre-creme)]/50 transition-colors disabled:opacity-50"
        >
          {accountConfig.profile.cancelButton}
        </button>
      </div>
    </form>
  );
}
