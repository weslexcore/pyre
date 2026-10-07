// The New task / New board / New goal actions that sit beside the view pills
// on every cross-board page (CreateActions.tsx). Each opens its form in a
// dialog over whatever page the person is on:
//
//   * New task opens global search on its Create task form (CREATE_TASK_EVENT).
//   * New board writes the board and goes to it — the KPIs and the columns
//     are set up there.
//   * New goal writes the goal and opens it on All goals. Already there, the
//     page takes GOAL_CREATED_EVENT instead: it reloads and opens the goal
//     without a navigation.

export const GOAL_CREATED_EVENT = 'admin:goal-created';
