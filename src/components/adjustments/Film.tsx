import { useTranslation } from 'react-i18next';
import Slider from '../ui/Slider';
import { Adjustments, FilmAdjustment } from '../../utils/adjustments';
import { FILM_PROFILE_NAMES, filmProfilePatch } from '../../utils/filmProfiles';
import Dropdown from '../ui/Dropdown';
import Switch from '../ui/Switch';

interface FilmPanelProps {
  adjustments: Adjustments;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  onDragStateChange?: (isDragging: boolean) => void;
}

// Film simulation section (port of the Krea WebGL2 film PoC "Film look"
// group). Per-pixel dials (contrast/saturation/shadows/highlights/rolloff/
// bleed/cross) live in the WGSL film block; blur drives a dedicated
// post-pass. Grain lives in the sibling Grain section; halation is the
// native dial in the Film tab's Look block.
export default function FilmPanel({ adjustments, setAdjustments, onDragStateChange }: FilmPanelProps) {
  const { t } = useTranslation();

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const handleFilmProfileSelect = (profileId: string) => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      ...filmProfilePatch(profileId === 'off' ? null : profileId),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <div className="mb-2">
          <Dropdown
            options={[
              { label: t('adjustments.effects.filmOff'), value: 'off' },
              ...FILM_PROFILE_NAMES.map((n) => ({ label: n, value: n })),
            ]}
            value={adjustments.filmProfile || 'off'}
            onChange={handleFilmProfileSelect}
          />
        </div>
        <Slider
          label={t('adjustments.effects.filmStrength')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmStrength, e.target.value)}
          step={1}
          value={adjustments.filmStrength}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={100}
          label={t('adjustments.effects.filmContrast')}
          max={150}
          min={50}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmContrast, e.target.value)}
          step={1}
          value={adjustments.filmContrast}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          defaultValue={100}
          label={t('adjustments.effects.filmSaturation')}
          max={200}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmSaturation, e.target.value)}
          step={1}
          value={adjustments.filmSaturation}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.effects.filmRolloff')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmRolloff, e.target.value)}
          step={1}
          value={adjustments.filmRolloff}
          onDragStateChange={onDragStateChange}
        />
        <Slider
          label={t('adjustments.effects.filmBleed')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(FilmAdjustment.FilmBleed, e.target.value)}
          step={1}
          value={adjustments.filmBleed}
          onDragStateChange={onDragStateChange}
        />
        <Switch
          label={t('adjustments.effects.filmCross')}
          checked={!!adjustments.filmCross}
          onChange={(v: boolean) => setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, filmCross: v }))}
        />
      </div>
    </div>
  );
}
