/** Comparable evidence, independent of any search/model provider. Unknown is never a conflict. */
export const attributes = ['category', 'subtype', 'gender', 'age_group', 'color', 'sleeve', 'brand', 'model', 'material', 'neckline'] as const;
export type Attribute = typeof attributes[number];
export type Observation = { value: string | null; confidence: number; basis: 'image' | 'metadata' | 'description' };
export type Evidence = Partial<Record<Attribute, Observation>>;
export type ImageComparison = {
  source: Evidence;
  candidate: Evidence;
  similarity: number;
  confidence: number;
  matching_details: string[];
};

export function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function phrase(text: string, value: string): boolean {
  return Boolean(normalize(value)) && ` ${normalize(text)} `.includes(` ${normalize(value)} `);
}

const typeAliases: Record<string, string[]> = {
  sweater: ['sweater', 'sweaters', 'jumper', 'jumpers', 'pullover', 'pullovers'],
  cardigan: ['cardigan', 'cardigans'], hoodie: ['hoodie', 'hoodies', 'hooded sweatshirt'],
  sweatshirt: ['sweatshirt', 'sweatshirts'], polo: ['polo', 'polos'],
  't shirt': ['t shirt', 't shirts', 'tshirt', 'tee', 'tees'],
  shirt: ['shirt', 'shirts', 'blouse', 'blouses'],
  jacket: ['jacket', 'jackets', 'blazer', 'blazers'], coat: ['coat', 'coats', 'overcoat', 'trench coat'],
  dress: ['dress', 'dresses'], skirt: ['skirt', 'skirts'], shorts: ['shorts'],
  jeans: ['jeans'], trousers: ['trousers', 'pants', 'chinos'], leggings: ['leggings'],
  tank: ['tank', 'tank top', 'vest top'], sneakers: ['sneakers', 'trainers'],
  boots: ['boots'], shoes: ['shoes'], bag: ['bag', 'handbag', 'backpack'],
  sunglasses: ['sunglasses'], watch: ['watch'], mug: ['mug', 'cup'], lamp: ['lamp'],
};

export function productType(text: string): string | null {
  const found = Object.entries(typeAliases).filter(([, words]) => words.some((word) => phrase(text, word))).map(([type]) => type);
  // Compound product names and parent/child categories aren't two different products.
  if (found.includes('polo') || found.includes('t shirt')) found.splice(found.indexOf('shirt'), found.includes('shirt') ? 1 : 0);
  if (found.includes('hoodie')) found.splice(found.indexOf('sweatshirt'), found.includes('sweatshirt') ? 1 : 0);
  if (found.includes('jeans') || found.includes('shorts') || found.includes('leggings')) found.splice(found.indexOf('trousers'), found.includes('trousers') ? 1 : 0);
  return found.length === 1 ? found[0] : null;
}

export function colorFamily(text: string): string | null {
  const aliases: Record<string, string> = { grey: 'gray', charcoal: 'gray', navy: 'blue', burgundy: 'red', maroon: 'red', ivory: 'cream', tan: 'beige', khaki: 'beige' };
  const colors = ['black', 'white', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'beige', 'cream', 'gold', 'silver'];
  const found = new Set([...colors, ...Object.keys(aliases)].filter((color) => phrase(text, color)).map((color) => aliases[color] ?? color));
  return found.size === 1 ? [...found][0] : null;
}

export function gender(text: string): string | null {
  if (phrase(text, 'unisex')) return null;
  const men = /\b(men|mens|man|male)\b/.test(normalize(text));
  const women = /\b(women|womens|woman|ladies|female)\b/.test(normalize(text));
  return men === women ? null : men ? 'men' : 'women';
}

export function ageGroup(text: string): string | null {
  const value = normalize(text);
  const child = /\b(kids|kid|children|child|boys|girls|youth|toddler|baby)\b/.test(value);
  const adult = /\b(adult|men|mens|women|womens|ladies)\b/.test(value);
  return child === adult ? null : child ? 'child' : 'adult';
}

export function sleeve(text: string): string | null {
  const value = normalize(text);
  const found = [
    /\b(long sleeves?|long sleeved|longsleeve)\b/.test(value) ? 'long' : null,
    /\b(short sleeves?|short sleeved|shortsleeve|cap sleeves?|cap sleeved)\b/.test(value) ? 'short' : null,
    /\b(sleeveless|tank top|vest top)\b/.test(value) ? 'sleeveless' : null,
    /\b(three quarter|3 4)\b/.test(value) ? 'three quarter' : null,
  ].filter(Boolean);
  return found.length === 1 ? found[0] : null;
}

export function canonical(attribute: Attribute, value: string | null | undefined): string | null {
  const text = normalize(value);
  if (!text || /^(unknown|unclear|none|null|n a|not visible|unisex|multicolor|multi color)$/.test(text)) return null;
  if (attribute === 'color') return colorFamily(text);
  if (attribute === 'gender') return gender(text);
  if (attribute === 'age_group') return ageGroup(text);
  if (attribute === 'sleeve') return ['long', 'short', 'sleeveless', 'three quarter'].includes(text) ? text : sleeve(text);
  if (attribute === 'subtype') return productType(text);
  if (attribute === 'neckline') {
    if (/^(crew|crewneck|crew neck|round|round neck)$/.test(text)) return 'crew';
    if (/^(v|vneck|v neck)$/.test(text)) return 'v neck';
  }
  if (attribute === 'category') {
    if (/^(apparel|clothing|garment|top|tops|bottoms|outerwear)$/.test(text)) return 'apparel';
    const type = productType(text);
    if (type) return ['sneakers', 'boots', 'shoes'].includes(type) ? 'shoes'
      : ['bag', 'sunglasses', 'watch', 'mug', 'lamp'].includes(type) ? type : 'apparel';
    return null;
  }
  return text;
}

export function compatible(attribute: Attribute, a: string, b: string): boolean {
  if (a === b) return true;
  // A more specific subtype is compatible with a genuine parent, never its sibling.
  const parents: Record<string, string[]> = { sweater: ['cardigan'], shoes: ['sneakers', 'boots'] };
  if (attribute === 'subtype') return Boolean(parents[a]?.includes(b) || parents[b]?.includes(a));
  // A shorter whole brand name may be a visible fragment of a longer label. No brand lists.
  if (attribute === 'brand') return phrase(a, b) || phrase(b, a);
  return false;
}
