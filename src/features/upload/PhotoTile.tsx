import { useId, useRef, useState } from 'react';
import { useAppStore, type PhotoKind } from '../../state/store.js';
import { ACCEPTED_TYPES, PhotoLoadError, loadPhoto } from './loadPhoto.js';

interface PhotoTileProps {
  kind: PhotoKind;
  title: string;
  hint: string;
}

/**
 * One photo drop tile.
 *
 * The tile owns its own busy flag and refuses drops while decoding -- users
 * reliably drop a second photo mid-processing.
 */
export function PhotoTile({ kind, title, hint }: PhotoTileProps) {
  const photo = useAppStore((s) => s.photos[kind]);
  const setPhoto = useAppStore((s) => s.setPhoto);
  const rotatePhoto = useAppStore((s) => s.rotatePhoto);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  async function accept(file: File | undefined) {
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    try {
      setPhoto(kind, await loadPhoto(file));
    } catch (cause) {
      setError(
        cause instanceof PhotoLoadError ? cause.message : 'Could not read that file',
      );
    } finally {
      setBusy(false);
      // Allow re-picking the same file after an error.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const size = photo;

  return (
    <section className="tile">
      <header className="tile__header">
        <h2>{title}</h2>
        {photo && (
          <div className="tile__actions">
            <button type="button" onClick={() => void rotatePhoto(kind, -1)} title="Rotate left">
              ⟲
            </button>
            <button type="button" onClick={() => void rotatePhoto(kind, 1)} title="Rotate right">
              ⟳
            </button>
            <button type="button" onClick={() => setPhoto(kind, null)} title="Remove">
              ✕
            </button>
          </div>
        )}
      </header>

      <label
        htmlFor={inputId}
        className="tile__drop"
        data-dragging={dragging || undefined}
        data-busy={busy || undefined}
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void accept(e.dataTransfer.files[0]);
        }}
      >
        {photo ? (
          <img
            className="tile__image"
            src={photo.url}
            alt={title}
          />
        ) : (
          <span className="tile__placeholder">{busy ? 'Reading…' : hint}</span>
        )}

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          className="tile__input"
          accept={ACCEPTED_TYPES.join(',')}
          disabled={busy}
          onChange={(e) => void accept(e.target.files?.[0])}
        />
      </label>

      <footer className="tile__footer">
        {error ? (
          <span className="tile__error">{error}</span>
        ) : size ? (
          <span>
            {size.width} × {size.height} px
          </span>
        ) : (
          <span className="tile__muted">No photo</span>
        )}
      </footer>
    </section>
  );
}
