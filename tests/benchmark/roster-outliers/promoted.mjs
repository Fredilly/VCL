import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function promotedCases(directory = fileURLToPath(new URL('./promoted/', import.meta.url))) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => {
    const fixture = JSON.parse(readFileSync(`${directory}/${name}`, 'utf8'));
    if (!fixture.id || fixture.truth !== 'IN_ROSTER' || !fixture.comparisons || !Object.keys(fixture.comparisons).length || !fixture.candidates?.some(row => row.identity.canonical_key === fixture.expected_class)) throw new Error(`Invalid reviewed correction fixture: ${name}`);
    return fixture;
  });
}
