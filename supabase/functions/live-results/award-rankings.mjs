// Derived from the complete source results, never from a filtered public view.
// Source overall places are authoritative; sorting the UI cannot reassign awards.
export function awardRankings(rows, awards = {}) {
  const count = value => { const n = Number(value ?? 3); return Number.isInteger(n) && n >= 0 && n <= 20 ? n : 3; };
  const overallCount = count(awards.overall_places), ageCount = count(awards.age_group_places);
  const groups = Array.isArray(awards.age_groups) ? awards.age_groups : [];
  const output = new Map(rows.map(row => [row, {}]));
  const races = new Map();
  for (const row of rows) {
    const place = Number(row.overall);
    if (!Number.isFinite(place) || place <= 0) continue;
    const race = String(row.race ?? row.category ?? '').trim();
    if (!races.has(race)) races.set(race, []);
    races.get(race).push(row);
  }
  const sex = row => String(row.sex ?? '').trim().toLowerCase();
  function rank(list, field, limit = Infinity) {
    let place = 0, previous;
    list.forEach((row, index) => {
      if (Number(row.overall) !== previous) place = index + 1;
      previous = Number(row.overall);
      if (place <= limit) output.get(row)[field] = place;
    });
  }
  for (const race of races.values()) {
    race.sort((a,b) => Number(a.overall) - Number(b.overall));
    for (const gender of ['male','female']) rank(race.filter(row => sex(row) === gender), 'overallAwardPlace', overallCount);
    const buckets = new Map();
    for (const row of race) {
      // Missing ages must not become age zero. Explicit labels remain authoritative.
      const age = row.age == null || String(row.age).trim() === '' ? NaN : Number(row.age);
      const explicit = String(row.ageGroup ?? '').trim();
      const index = groups.findIndex(group => {
        const division = String(group.division ?? group.gender ?? 'All').trim().toLowerCase();
        return (!division || division === 'all' || division === sex(row)) &&
          (explicit ? explicit === String(group.label ?? group.name ?? '').trim() :
            Number.isFinite(age) && age >= Number(group.min ?? group.min_age ?? 0) && age <= Number(group.max ?? group.max_age ?? 999));
      });
      if (index < 0) continue;
      if (!buckets.has(index)) buckets.set(index, []);
      buckets.get(index).push(row);
    }
    for (const group of buckets.values()) {
      rank(group, 'ageGroupPlace');
      const eligible = awards.remove_overall_from_age_groups === true ? group.filter(row => !output.get(row).overallAwardPlace) : group;
      rank(eligible, 'ageGroupAwardPlace', ageCount);
    }
  }
  return output;
}
