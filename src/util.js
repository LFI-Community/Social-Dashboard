// Normalisation pour la dédup des personnes (RNE sans identifiant unique).
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function dedupKey({ last_name, first_name, birth_date }) {
  return [normalizeName(last_name), normalizeName(first_name), String(birth_date || '').trim()].join('|');
}

export function slugify(s) {
  return normalizeName(s).replace(/\s+/g, '-').slice(0, 80);
}

// Poids par type de mandat (importance institutionnelle / audience présumée).
// Ajustable après le brainstorm BMAD.
export const MANDATE_WEIGHT = {
  mep: 1.0,
  ministre: 1.0,
  depute: 0.9,
  senateur: 0.9,
  cr_president: 0.85,
  cd_president: 0.85,
  maire_grande_ville: 0.8,
  maire: 0.6,
  cr: 0.5,
  cd: 0.5,
  epci: 0.35,
  arrondissement: 0.3,
  cm: 0.25,
  afe: 0.3,
  public_figure: 0.7,
  autre: 0.25,
};

export function mandateWeight(type) {
  return MANDATE_WEIGHT[type] ?? MANDATE_WEIGHT.autre;
}
