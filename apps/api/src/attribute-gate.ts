import type { ObjectDescription } from './types.js';
import type { ProductCandidate, ProductContext } from './commerce.js';

type Gender = 'men' | 'women';
type Sleeve = 'long' | 'short' | 'sleeveless';

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function sourceText(description: ObjectDescription, context?: ProductContext): string {
  return normalized([
    description.category,
    description.subcategory,
    ...description.style_attributes,
    ...description.visible_text,
    ...description.logos_markings,
    ...description.distinctive_features,
    ...description.shape_silhouette,
    ...description.search_terms,
    context?.title ?? '',
  ].join(' '));
}

function titleGender(value: string): Gender | null {
  const text = ` ${normalized(value)} `;
  const women = /\b(women|womens|woman|ladies|female)\b/.test(text);
  const men = /\b(men|mens|man|male)\b/.test(text);
  if (women === men) return null;
  return women ? 'women' : 'men';
}

function sourceGender(description: ObjectDescription, context?: ProductContext): Gender | null {
  const text = sourceText(description, context);
  const women = /\b(women|womens|woman|ladies|female)\b/.test(text);
  const men = /\b(men|mens|man|male)\b/.test(text);
  if (women === men) return null;
  return women ? 'women' : 'men';
}

function sleeve(value: string): Sleeve | null {
  const text = normalized(value);
  if (/\b(sleeveless|tank top|vest top)\b/.test(text)) return 'sleeveless';
  if (/\b(short sleeve|short sleeved|shortsleeve)\b/.test(text)) return 'short';
  if (/\b(long sleeve|long sleeved|longsleeve)\b/.test(text)) return 'long';
  return null;
}

function sourceSleeve(description: ObjectDescription): Sleeve | null {
  return sleeve([
    description.subcategory,
    ...description.style_attributes,
    ...description.distinctive_features,
    ...description.shape_silhouette,
    ...description.search_terms,
  ].join(' '));
}

export function applyAttributeInvariantGate(
  description: ObjectDescription,
  products: ProductCandidate[],
  context?: ProductContext,
): ProductCandidate[] {
  const expectedGender = sourceGender(description, context);
  const expectedSleeve = sourceSleeve(description);

  return products.filter((product) => {
    const candidateGender = titleGender(product.title);
    if (expectedGender && candidateGender && candidateGender !== expectedGender) return false;

    const candidateSleeve = sleeve(product.title);
    if (expectedSleeve && candidateSleeve && candidateSleeve !== expectedSleeve) return false;

    return true;
  });
}
