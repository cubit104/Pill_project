export function stripDoseFromName(name: string): string {
  // Matches trailing strengths like "75 mg", "10/20 mg", ".5 mg", and "0.5 %".
  return name.replace(/\s+(?:\d+\.?\d*|\.\d+)[\d./]*\s*(mg|mcg|ml|g|%|units?|iu|meq)\s*$/i, '').trim()
}
