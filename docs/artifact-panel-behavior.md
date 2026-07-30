# Artifact Panel Behavior

Contextual (closed by default; opens from message "View the work", header tabs, or approval
cards). Drag the left grip to resize (min 320px, max 60% viewport; conversation keeps the
rest); width persists in localStorage and restores on relaunch; double-click the grip resets
to 460px; the grip is keyboard-focusable (Left/Right arrows resize, visible focus ring).
Full-view toggle maximizes the panel; **Esc** exits. Close returns to pure conversation.
Content: artifact tabs (matrix, drafts per section, budget, logic model, review, checks,
brief, export) with version selector + line diffs; website previews render in a sandboxed
same-app iframe that resizes with the panel without reloading the workspace. Slide-in uses a
160–200ms ease-out and respects `prefers-reduced-motion`.
