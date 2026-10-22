export function formatTime(ms: number, precise = false): string {
  const value = Math.max(0, Math.round(ms));
  const minutes = Math.floor(value / 60000);
  const seconds = Math.floor((value % 60000) / 1000).toString().padStart(2, '0');
  return `${minutes}:${seconds}${precise ? `.${(value % 1000).toString().padStart(3, '0')}` : ''}`;
}
