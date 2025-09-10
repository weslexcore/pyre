import { createProfileMetadata, validateProfileData, isProfileDataComplete } from './profile';

describe('profile utils', () => {
  test('createProfileMetadata builds partial metadata safely', () => {
    const meta1 = createProfileMetadata({ first_name: 'Ada' });
    expect(meta1).toEqual({ first_name: 'Ada' });

    // preferences should not throw if previously undefined
    const meta2 = createProfileMetadata({ preferences: { email_notifications: false } });
    expect(meta2).toEqual({ preferences: { email_notifications: false } });

    const meta3 = createProfileMetadata({
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '2000-01-01',
      phone: '+12025550123',
      preferences: { sms_notifications: true },
    });
    expect(meta3).toMatchObject({
      first_name: 'Ada',
      last_name: 'Lovelace',
      date_of_birth: '2000-01-01',
      phone: '+12025550123',
      preferences: { sms_notifications: true },
    });
  });

  test('validateProfileData flags empty names and invalid phone', () => {
    const invalid = validateProfileData({
      first_name: '',
      last_name: ' ',
      date_of_birth: '',
      phone: 'abc123',
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.first_name).toBeTruthy();
    expect(invalid.errors.last_name).toBeTruthy();
    expect(invalid.errors.date_of_birth).toBeTruthy();
    expect(invalid.errors.phone).toBeTruthy();
  });

  test('validateProfileData allows valid DOB and future dates are rejected', () => {
    const ok = validateProfileData({
      first_name: 'Jane',
      last_name: 'Doe',
      date_of_birth: '2000-01-01',
    });
    expect(ok.valid).toBe(true);

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    const yyyy = futureDate.getFullYear();
    const mm = String(futureDate.getMonth() + 1).padStart(2, '0');
    const dd = String(futureDate.getDate()).padStart(2, '0');
    const future = `${yyyy}-${mm}-${dd}`;

    const bad = validateProfileData({ date_of_birth: future });
    expect(bad.valid).toBe(false);
    expect(bad.errors.date_of_birth).toBeTruthy();
  });

  test('isProfileDataComplete requires all required fields', () => {
    expect(
      isProfileDataComplete({ first_name: 'A', last_name: 'B', date_of_birth: '2000-01-01' })
    ).toBe(true);
    expect(isProfileDataComplete({ first_name: 'A', last_name: 'B' })).toBe(false);
  });
});
