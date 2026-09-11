import type { ProductCandidate } from './commerce.js';

export type CandidateColorResult = { index: number; color: string | null; confidence: number };

const aliases: Record<string, string> = { grey: 'gray', charcoal: 'gray', ivory: 'cream', navy: 'blue', burgundy: 'red', maroon: 'red', tan: 'beige', khaki: 'beige' };
const colors = ['black','white','gray','red','orange','yellow','green','blue','purple','pink','brown','beige','cream','gold','silver'];

function norm(value: string | null | undefined) { return (value ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }

export function normalizeColorFamily(value: string | null | undefined): string | null {
  const text = norm(value);
  if (!text) return null;
  if (aliases[text]) return aliases[text];
  return colors.find((color) => ` ${text} `.includes(` ${color} `)) ?? null;
}

export function candidateImageColorCompatible(selectedColor: string, result?: CandidateColorResult): boolean {
  const expected = normalizeColorFamily(selectedColor);
  if (!expected || !result || result.confidence < 0.75) return true;
  const observed = normalizeColorFamily(result.color);
  return !observed || observed === expected;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

async function fetchImage(candidate: ProductCandidate, index: number) {
  if (!candidate.image_reference) return null;
  try {
    const response = await fetch(candidate.image_reference);
    if (!response.ok) return null;
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    if (!mimeType.startsWith('image/')) return null;
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > 2000000) return null;
    return { index, mimeType, data: toBase64(new Uint8Array(buffer)) };
  } catch { return null; }
}

export async function classifyCandidateImageColors(apiKey: string, model: string, candidates: ProductCandidate[]) {
  const images = (await Promise.all(candidates.slice(0, 8).map(fetchImage))).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const out = new Map<number, CandidateColorResult>();
  if (!images.length) return out;

  const parts: any[] = [{ text: 'For each product image, identify the dominant visible color of the main product only. Ignore background, people, borders, text and packaging. Return JSON only as an array of {index,color,confidence}. Use simple color names. If unclear or multicolor, color must be null and confidence below 0.75.' }];
  for (const image of images) {
    parts.push({ text: `Candidate index ${image.index}` });
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
    });
    if (!response.ok) return out;
    const payload: any = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.find((part: any) => typeof part.text === 'string')?.text;
    const parsed = text ? JSON.parse(text) : [];
    if (!Array.isArray(parsed)) return out;
    for (const item of parsed) {
      const index = Number(item?.index); const confidence = Number(item?.confidence);
      if (Number.isInteger(index) && index >= 0 && index < candidates.length && Number.isFinite(confidence)) {
        out.set(index, { index, color: item?.color == null ? null : String(item.color), confidence: Math.max(0, Math.min(1, confidence)) });
      }
    }
  } catch {}
  return out;
}
