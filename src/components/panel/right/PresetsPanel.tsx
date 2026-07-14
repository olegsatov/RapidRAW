import PresetsBrowser from '../../presets/PresetsBrowser';

interface PresetsPanelProps {
  onNavigateToCommunity(): void;
}

export default function PresetsPanel({ onNavigateToCommunity }: PresetsPanelProps) {
  return <PresetsBrowser isVisible onNavigateToCommunity={onNavigateToCommunity} />;
}
