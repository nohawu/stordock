export async function copyText(value: string): Promise<void> {
  if (window.ossDesk?.writeClipboardText) {
    await window.ossDesk.writeClipboardText(value);
    return;
  }
  await navigator.clipboard.writeText(value);
}
