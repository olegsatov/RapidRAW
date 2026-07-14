export const EDITOR_BACKGROUND_OPTIONS: { label: string; color: string }[] = [
  { label: '100%', color: 'rgb(255, 255, 255)' },
  { label: '90%', color: 'rgb(230, 230, 230)' },
  { label: '75%', color: 'rgb(191, 191, 191)' },
  { label: '60%', color: 'rgb(153, 153, 153)' },
  { label: '45%', color: 'rgb(115, 115, 115)' },
  { label: '30%', color: 'rgb(77, 77, 77)' },
  { label: '20%', color: 'rgb(51, 51, 51)' },
  { label: '10%', color: 'rgb(26, 26, 26)' },
  { label: '5%', color: 'rgb(13, 13, 13)' },
  { label: '0%', color: 'rgb(0, 0, 0)' },
];

export const EDITOR_BACKGROUND_COLORS = EDITOR_BACKGROUND_OPTIONS.map((option) => option.color);

export function getDefaultEditorBackground(): string {
  if (typeof document === 'undefined') {
    return 'rgb(35, 35, 35)';
  }
  const rootStyle = getComputedStyle(document.documentElement);
  return rootStyle.getPropertyValue('--app-bg-secondary').trim() || 'rgb(35, 35, 35)';
}
