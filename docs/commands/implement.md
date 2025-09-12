Guidelines for implementing a feature and managing task lists in markdown files to track progress on completing a PRD. Always start at the first subtask and continue on from there.

## Task Implementation
- **One sub-task at a time:** Do **NOT** start the next sub‑task until the prior one has been fully completed.
- **Document discovered tasks**: If a subtask or task ends up requiring work outside of the listed tasks, make sure that you document it in the task list. Ensure any referenced / affected files are added to the "Relevant Files" section.
- **Completion protocol:**  
  1. When you finish a **sub‑task**, immediately mark it as completed by changing `[ ]` to `[x]`.
  2. If **all** subtasks underneath a parent task are now `[x]`, follow this sequence:
    - **First**: Format and lint all files - `yarn lint:fix` and `yarn format`
    - **Second**: Run the test suite for the relevant projects ( `yarn test`, `yarn test:landing`, `yarn test:booking`, etc.)
    - **Third**: Ensure the build (`yarn build`) runs and passes (if expected to pass)
  3. Once all the subtasks are marked completed and tests have passed, continue to the next parent task.
- At the end of all tasks, all `yarn lint:fix`, `yarn format` and `yarn build` commands must be run and pass for the relevant project

## Task List Maintenance

1. **Update the task list as you work:**
   - Mark tasks and subtasks as completed (`[x]`) per the protocol above.
   - Add new tasks as they emerge.

2. **Maintain the "Relevant Files" section:**
   - List every file created or modified.
   - Give each file a one‑line description of its purpose.

## AI Instructions

When working with task lists, the AI must:

1. Regularly update the task list file after finishing any significant work.
2. Follow the completion protocol:
   - Mark each finished **sub‑task** `[x]`.
   - Mark the **parent task** `[x]` once **all** its subtasks are `[x]`.
3. Add newly discovered tasks.
4. Keep "Relevant Files" accurate and up to date.
5. Before starting work, check which sub‑task is next.