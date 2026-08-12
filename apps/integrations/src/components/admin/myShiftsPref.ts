// The "My shifts" filter's persisted state, shared by the week board and the
// month calendar so the choice follows the viewer between the two tabs.

const MY_SHIFTS_KEY = 'pyre-schedule-my-shifts';

export const readMyShiftsPref = (): boolean => {
  try {
    return localStorage.getItem(MY_SHIFTS_KEY) === '1';
  } catch {
    return false;
  }
};

export const writeMyShiftsPref = (on: boolean): void => {
  try {
    localStorage.setItem(MY_SHIFTS_KEY, on ? '1' : '0');
  } catch {
    // Private mode etc. — the toggle still works for the session.
  }
};
