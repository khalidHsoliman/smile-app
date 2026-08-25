/**
 * Recovering the bytes behind a photo's object URL.
 *
 * The store holds object URLs because that is what `<img>` and the detector
 * want, but persistence needs the underlying Blob -- an object URL is only
 * valid inside the document that created it, so storing one would restore a
 * dead reference.
 *
 * `fetch` on a blob: URL returns the original bytes without a copy, which is
 * why this is cheap enough to run on every save.
 */
export async function loadPhotoBlob(url: string): Promise<Blob | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    // The URL was revoked between the store read and this call -- the next
    // save will pick up whatever replaced it.
    return null;
  }
}
