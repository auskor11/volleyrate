// Which camera a video is from: side or behind a team (and which team), plus a short name.
import { CAMERA_KINDS, type CameraKind } from '../lib/cameras';
import type { Team } from '../lib/rotation';

export interface CameraChoice { kind: CameraKind; name: string; behind?: Team }

export const defaultCamera = (kind: CameraKind = 'side'): CameraChoice =>
  kind === 'side' ? { kind, name: 'Side' } : { kind, name: 'Back', behind: 'a' };

export function CameraFields({ value, onChange, disabled }: { value: CameraChoice; onChange: (c: CameraChoice) => void; disabled?: boolean }) {
  const seg = (on: boolean) => `flex-1 rounded-md border px-2 py-1.5 text-sm ${on ? 'border-ball bg-ball/20 text-ball' : 'border-line text-muted'}`;
  return (
    <div className={`space-y-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <div className="flex gap-1.5">
        {(Object.keys(CAMERA_KINDS) as CameraKind[]).map(k => (
          <button key={k} type="button" className={seg(value.kind === k)}
            onClick={() => onChange(value.kind === k ? value : { ...defaultCamera(k), ...(value.name !== defaultCamera(value.kind).name ? { name: value.name } : {}) })}>
            {CAMERA_KINDS[k].label}
          </button>
        ))}
      </div>
      {value.kind === 'back' && (
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs text-muted">Behind</span>
          {(['a', 'b'] as const).map(t => (
            <button key={t} type="button" className={seg(value.behind === t)} onClick={() => onChange({ ...value, behind: t })}>Team {t.toUpperCase()}</button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-muted">
        Camera name
        <input value={value.name} maxLength={24} onChange={e => onChange({ ...value, name: e.target.value })}
          className="flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-sm text-ink outline-none focus:border-ball" />
      </label>
    </div>
  );
}
