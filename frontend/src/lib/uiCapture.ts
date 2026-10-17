/** True while a keystroke-capture field is listening; used to suppress other
 * Escape/default handlers (modals, global keybinds) during capture. */
export const uiCapture = { active: false };
