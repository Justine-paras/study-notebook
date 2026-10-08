// IPC channels used only between the preload script and the main process
// (the renderer never sees them). Kept free of imports so the sandboxed
// preload bundle stays self-contained.

/**
 * Sent (synchronously) with the disk path of every File the renderer asks
 * `pathForFile` about. Only a real dropped or picked file has a path, so the
 * main process can treat these as files the learner chose to import.
 */
export const PATH_GRANT_CHANNEL = 'bridge:grant-path'
