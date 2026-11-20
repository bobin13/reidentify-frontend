// Article photos without a feed image are looked up by the server
// (backend/news-page-images.js) and arrive as `previewImageUrl`.

// Presentation settings (size, crop, CDN wrapper) do not change which
// photograph a URL points at; mirrors imageIdentity in the backend.
export function newsImageIdentity(
  value: string | null | undefined,
): string | null {
  try {
    let url = new URL(value || "");
    if (url.protocol !== "https:") return null;
    if (/^i[0-3]\.wp\.com$/i.test(url.hostname)) {
      url = new URL("https://" + url.pathname.slice(1) + url.search);
    }
    url.hash = "";
    url.pathname = url.pathname.replace(
      /-\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp)$)/i,
      "",
    );
    for (const name of [...url.searchParams.keys()]) {
      if (
        /^(?:w|h|width|height|resize|fit|crop|quality|q|strip|dpr|auto|format|ssl|zoom|fbclid)$/i.test(
          name,
        ) ||
        /^utm_/i.test(name)
      )
        url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}
