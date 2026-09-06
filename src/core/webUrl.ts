/** True for a URL safe to open or render as a link: only http(s), never javascript: or data:. */
export function isSafeWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
