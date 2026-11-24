// Copy / paste / share, each with the fallbacks real devices need.

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older WebViews and non-secure pages: the textarea trick.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Resolves to the clipboard text, or null when the browser won't let a page read it. */
export async function pasteText() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** Opens the system share sheet. Resolves false when unavailable or cancelled. */
export async function shareText(text, title) {
  if (!canShare()) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    return false; // dismissed by the user
  }
}
