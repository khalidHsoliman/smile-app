import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store.js';
import { toFDI } from '../../domain/teeth.js';
import { downloadBlob } from '../../export/snapshot.js';
import { reportImageFileName } from '../../export/fileNames.js';
import { useSnapshots, type SnapshotKind } from './useSnapshots.js';

/**
 * The report.
 *
 * "The report is what the clinician shows the patient. Treat it as a product
 * surface, not an export utility." So it is laid out to be shown on screen and
 * printed as-is, rather than being a download button with a preview.
 *
 * PDF export goes through the browser's print pipeline with a dedicated print
 * stylesheet: no dependency, vector-crisp text, and the clinician's own paper
 * size and margins are respected. The snapshots themselves are raster, captured
 * at the photo's native resolution.
 */
export function ReportStep() {
  const photos = useAppStore((s) => s.photos);
  const selectedTeeth = useAppStore((s) => s.selectedTeeth);
  const patientName = useAppStore((s) => s.report.patientName);
  const clinicName = useAppStore((s) => s.report.clinicName);
  const setReportField = useAppStore((s) => s.setReportField);

  const { snapshots, generate, busy, error } = useSnapshots();
  const [generated, setGenerated] = useState(false);

  // Capture once on entry. Re-running on every render would re-encode several
  // full-resolution images for nothing.
  useEffect(() => {
    if (!generated && photos.smile) {
      setGenerated(true);
      void generate();
    }
  }, [generated, photos.smile, generate]);

  if (!photos.smile) {
    return <p className="placeholder">Upload a smile photo first.</p>;
  }

  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const save = (kind: SnapshotKind, label: string) => {
    const blob = snapshots.blobs[kind];
    if (blob) downloadBlob(blob, reportImageFileName(patientName, label));
  };

  return (
    <div className="step step--report">
      {/* Controls are screen-only; the print stylesheet hides them. */}
      <div className="report__controls no-print">
        <label className="field">
          <span>Patient</span>
          <input
            value={patientName}
            placeholder="Patient name"
            onChange={(e) => setReportField('patientName', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Clinic</span>
          <input
            value={clinicName}
            placeholder="Clinic name"
            onChange={(e) => setReportField('clinicName', e.target.value)}
          />
        </label>

        <button type="button" onClick={() => window.print()} disabled={busy}>
          Export PDF
        </button>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
        >
          {busy ? 'Rendering…' : 'Regenerate'}
        </button>

        {error && <span className="report__error">{error}</span>}
      </div>

      <article className="report">
        <header className="report__header">
          <div>
            <h1>{clinicName || 'Smile design'}</h1>
            <p className="report__meta">
              {patientName || 'Patient'} · {today}
            </p>
          </div>
          <p className="report__teeth">
            {selectedTeeth.length > 0
              ? `Teeth ${selectedTeeth.map(toFDI).join(', ')}`
              : 'No teeth selected'}
          </p>
        </header>

        {/*
          The close-up pair leads. It is the most persuasive image
          in the report -- it is what the patient leans in to look at -- so it
          gets the top of the page rather than being buried under the full
          photographs.
        */}
        <Pair
          title="Close-up"
          before={snapshots.images.closeBefore}
          after={snapshots.images.closeAfter}
          busy={busy}
          onSaveBefore={() => save('closeBefore', 'closeup-before')}
          onSaveAfter={() => save('closeAfter', 'closeup-after')}
        />

        <Pair
          title="Smile"
          before={snapshots.images.smileBefore}
          after={snapshots.images.smileAfter}
          busy={busy}
          onSaveBefore={() => save('smileBefore', 'smile-before')}
          onSaveAfter={() => save('smileAfter', 'smile-after')}
        />

        {snapshots.images.retractedBefore &&
          (snapshots.images.retractedAfter ? (
            <Pair
              title="Retracted view"
              before={snapshots.images.retractedBefore}
              after={snapshots.images.retractedAfter}
              busy={busy}
              onSaveBefore={() => save('retractedBefore', 'retracted-before')}
              onSaveAfter={() => save('retractedAfter', 'retracted-after')}
            />
          ) : (
            /* No alignment, so there is nothing to place a design against. */
            <section className="report__pair">
              <h2>Retracted view</h2>
              <div className="report__images">
                <figure>
                  <img src={snapshots.images.retractedBefore} alt="Retracted view" />
                  <figcaption>Reference</figcaption>
                </figure>
              </div>
            </section>
          ))}

        <footer className="report__footer">
          <p>
            This is a visual simulation for discussion, not a guarantee of
            clinical outcome. Tooth colour is approximated from the photograph
            and is not a shade match.
          </p>
        </footer>
      </article>
    </div>
  );
}

interface PairProps {
  title: string;
  before: string | undefined;
  after: string | undefined;
  busy: boolean;
  onSaveBefore: () => void;
  onSaveAfter: () => void;
}

function Pair({ title, before, after, busy, onSaveBefore, onSaveAfter }: PairProps) {
  if (!before && !after) {
    return (
      <section className="report__pair">
        <h2>{title}</h2>
        <p className="placeholder">{busy ? 'Rendering…' : 'Not available'}</p>
      </section>
    );
  }

  return (
    <section className="report__pair">
      <h2>{title}</h2>
      <div className="report__images">
        <figure>
          {before && <img src={before} alt={`${title} before`} />}
          <figcaption>
            Before
            <button type="button" className="no-print" onClick={onSaveBefore}>
              PNG
            </button>
          </figcaption>
        </figure>
        <figure>
          {after && <img src={after} alt={`${title} after`} />}
          <figcaption>
            After
            <button type="button" className="no-print" onClick={onSaveAfter}>
              PNG
            </button>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
