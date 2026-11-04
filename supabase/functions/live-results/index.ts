import { awardRankings } from './award-rankings.mjs';

// Public participant fields are opt-in. Unknown properties and structured values never cross this boundary.
function publicScalar(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined;
}
function publicPick(source, fields) {
  const out = {};
  for (const key of fields) {
    const value = publicScalar(source?.[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
function displayAllowed(settings, field) { return settings?.[field] === true; }
function raceOf(row) {
  const value = publicScalar(row?.race ?? row?.category);
  return value === undefined ? '' : String(value).trim();
}
function gradeOf(row, settings) {
  const source = ['grade','category','age','city'].includes(String(settings?.grade_source || '')) ? String(settings.grade_source) : 'grade';
  const value = publicScalar(row?.[source]);
  return value === undefined ? '' : String(value).trim();
}

function publicEntry(row, settings, awards) {
  const out = {};
  const groups = {
    show_bib: ['bib'], show_name: ['firstName','lastName'], show_gender: ['sex'],
    show_age: ['age'], show_team: ['team'],
  };
  for (const [flag, fields] of Object.entries(groups)) {
    if (displayAllowed(settings, flag)) Object.assign(out, publicPick(row, fields));
  }
  const raceValue = raceOf(row);
  if (raceValue) out.race = raceValue;
  if (displayAllowed(settings, 'show_age_group')) {
    const safe = publicPick(row, ['age','sex','category','race']);
    const category = String(safe.category ?? '').trim();
    if (category) out.category = category;
    out.ageGroup = computedAgeGroup(safe, awards);
  }
  if (displayAllowed(settings, 'show_grade')) {
    const grade = gradeOf(row, settings);
    if (grade) out.grade = grade;
  }
  return out;
}

function publicResult(row, settings, awards) {
  const out = {};
  const groups = {
    show_overall_place: ['overall'], show_bib: ['bib'], show_name: ['firstName', 'lastName'],
    show_gender: ['sex'], show_age: ['age'], show_team: ['team'],
    show_gun_time: ['gunTime'], show_chip_time: ['chipTime'], show_pace: ['pace'],
  };
  for (const [flag, fields] of Object.entries(groups)) {
    if (displayAllowed(settings, flag)) Object.assign(out, publicPick(row, fields));
  }
  // Race identity is event structure, not a participant privacy field. Keep it separate from category.
  const raceValue = raceOf(row);
  if (raceValue) out.race = raceValue;
  if (displayAllowed(settings, 'show_age_group')) {
    const safe = publicPick(row, ['age', 'ageGroup', 'sex', 'category', 'race']);
    const category = String(safe.category ?? '').trim();
    if (category) out.category = category;
    out.ageGroup = computedAgeGroup(safe, awards);
  }
  if (displayAllowed(settings, 'show_grade')) {
    const grade = gradeOf(row, settings);
    if (grade) out.grade = grade;
  }
  return out;
}
function publicAwards(raw) {
  return {
    ...publicPick(raw, ['overall_places', 'age_group_places']),
    remove_overall_from_age_groups: raw?.remove_overall_from_age_groups === true,
    age_groups: Array.isArray(raw?.age_groups) ? raw.age_groups.map(g => publicPick(g, ['min', 'max', 'min_age', 'max_age', 'division', 'gender', 'label', 'name'])) : [],
    special_divisions: Array.isArray(raw?.special_divisions) ? raw.special_divisions.map(g => publicPick(g, ['label', 'name', 'division', 'gender', 'category', 'places'])) : [],
  };
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

function normalizedAge(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function computedAgeGroup(result: any, awards: any): string {
  const explicit = String(result?.ageGroup ?? '').trim();
  if (explicit) return explicit;
  const age = normalizedAge(result?.age);
  if (age === null) return '';
  const groups = Array.isArray(awards?.age_groups) ? awards.age_groups : [];
  const sex = String(result?.sex ?? '').trim().toLowerCase();
  const match = groups.find((g: any) => {
    const min = Number(g?.min ?? g?.min_age ?? 0);
    const max = Number(g?.max ?? g?.max_age ?? 999);
    const division = String(g?.division ?? g?.gender ?? 'All').trim().toLowerCase();
    const sexMatch = !division || division === 'all' || division === sex;
    return Number.isFinite(min) && Number.isFinite(max) && age >= min && age <= max && sexMatch;
  });
  return match ? String(match.label ?? match.name ?? '').trim() : '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return jsonResponse({ error: 'invalid_slug' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'server_not_configured' }, 500);

  const h = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };

  const eventRes = await fetch(
    `${supabaseUrl}/rest/v1/live_events?select=id,slug,name,location,event_date,start_time_label,distance_label,status,current_revision,last_published_at&slug=eq.${encodeURIComponent(slug)}&is_public=eq.true&limit=1`,
    { headers: h },
  );

  if (!eventRes.ok) return jsonResponse({ error: 'event_lookup_failed' }, 500);
  const events = await eventRes.json();
  if (!Array.isArray(events) || events.length === 0) return jsonResponse({ error: 'not_found' }, 404);

  const event = events[0];
  let snapshot: any = null;
  let settings: any = null;

  if (Number(event.current_revision) > 0) {
    const snapRes = await fetch(
      `${supabaseUrl}/rest/v1/result_snapshots?select=revision,source_updated_at,received_at,payload&event_id=eq.${event.id}&revision=eq.${event.current_revision}&limit=1`,
      { headers: h },
    );
    if (!snapRes.ok) return jsonResponse({ error: 'snapshot_lookup_failed' }, 500);
    const snaps = await snapRes.json();
    if (Array.isArray(snaps) && snaps.length > 0) snapshot = snaps[0];
  }

  const settingsRes = await fetch(
    `${supabaseUrl}/rest/v1/event_settings?select=timezone,show_gun_time,show_chip_time,show_pace,event_logo_path,event_logo_alt,accent_color,show_overall_place,show_bib,show_name,show_gender,show_age,show_age_group,show_grade,grade_source,show_team,show_recent_finishers,recent_finishers_default_count,show_entry_list,show_podium,podium_mode,podium_configs,featured_race_key,course_records,awards,team_scoring&event_id=eq.${event.id}&limit=1`,
    { headers: h },
  );
  if (settingsRes.ok) {
    const rows = await settingsRes.json();
    if (Array.isArray(rows) && rows.length > 0) settings = rows[0];
  }

  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return jsonResponse({ error: 'display_policy_unavailable' }, 503);

  let raceAliases: any[] = [];
  const aliasRes = await fetch(
    `${supabaseUrl}/rest/v1/event_race_aliases?select=race_key,display_label,scheduled_start_time,sort_order,running_clock_enabled,running_clock_start_at,running_clock_source&event_id=eq.${event.id}&active=eq.true&order=sort_order.asc,race_key.asc`,
    { headers: h },
  );
  if (aliasRes.ok) {
    const aliasRows = await aliasRes.json();
    if (Array.isArray(aliasRows)) raceAliases = aliasRows;
  }

  const dateLabel = event.event_date
    ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: '2-digit', timeZone: 'UTC' }).format(new Date(`${event.event_date}T00:00:00Z`))
    : null;

  const eventLogoUrl = settings?.event_logo_path
    ? `${supabaseUrl}/storage/v1/object/public/event-assets/${String(settings.event_logo_path).split('/').map(encodeURIComponent).join('/')}`
    : null;

  const awards = publicAwards(settings?.awards ?? {
    overall_places: 3,
    remove_overall_from_age_groups: true,
    age_groups: [],
    special_divisions: [],
  });

  const rawResults = Array.isArray(snapshot?.payload?.results) ? snapshot.payload.results : [];
  const rankings = awardRankings(rawResults, awards);
  function rankedPublicResult(row: any) {
    const out = publicResult(row, settings, awards);
    if (displayAllowed(settings, 'show_age_group') && displayAllowed(settings, 'show_overall_place')) {
      Object.assign(out, rankings.get(row) || {});
    }
    return out;
  }
  const results = rawResults.map(rankedPublicResult);
  const raceCounts = new Map<string, number>();
  for (const row of rawResults) {
    const race = raceOf(row);
    if (race) raceCounts.set(race, (raceCounts.get(race) ?? 0) + 1);
  }
  const aliasKeys = new Set(raceAliases.map((row: any) => String(row?.race_key ?? '').trim()).filter(Boolean));
  const races = raceAliases
    .map((row: any) => {
      const key = String(row?.race_key ?? '').trim();
      const startAt = typeof row?.running_clock_start_at === 'string' && Number.isFinite(Date.parse(row.running_clock_start_at))
        ? row.running_clock_start_at
        : null;
      const source = ['manual','admin_now','push','mylaps'].includes(String(row?.running_clock_source || ''))
        ? String(row.running_clock_source)
        : null;
      const scheduledRaw = String(row?.scheduled_start_time ?? '').trim();
      const scheduledStartTime = /^\d{2}:\d{2}(?::\d{2})?$/.test(scheduledRaw) ? scheduledRaw.slice(0,5) : null;
      return {
        key,
        label: String(row?.display_label ?? row?.race_key ?? '').trim() || key,
        scheduledStartTime,
        count: raceCounts.get(key) ?? 0,
        sortOrder: Number(row?.sort_order ?? 0),
        clock: { enabled: row?.running_clock_enabled === true && !!startAt, startAt, source },
      };
    })
    .filter((race: any) => !!race.key);
  for (const [key, count] of raceCounts.entries()) {
    if (!aliasKeys.has(key)) races.push({
      key, label:key, scheduledStartTime:null, count, sortOrder:999999,
      clock:{ enabled:false, startAt:null, source:null },
    });
  }
  races.sort((a: any, b: any) => a.sortOrder - b.sortOrder || String(a.label).localeCompare(String(b.label)));
  const publicRaces = races.map(({ sortOrder: _sortOrder, ...race }: any) => race);
  const configuredFeaturedRaceKey = String(settings?.featured_race_key ?? '').trim();
  const featuredRaceKey = publicRaces.some((race:any)=>String(race?.key||'')===configuredFeaturedRaceKey)
    ? configuredFeaturedRaceKey
    : (publicRaces[0]?.key ?? null);
  const validRaceKeys = new Set(publicRaces.map((race:any)=>String(race?.key||'')).filter(Boolean));
  const podiumMode = ['featured','custom','off'].includes(String(settings?.podium_mode||''))
    ? String(settings.podium_mode)
    : (settings?.show_podium===false?'off':'featured');
  const podiumConfigs = (Array.isArray(settings?.podium_configs)?settings.podium_configs:[]).map((row:any)=>({
    raceKey:String(row?.race_key||'').trim(),
    gender:['Male','Female','Both'].includes(String(row?.gender||''))?String(row.gender):'Both',
    places:Number.isInteger(Number(row?.places))?Math.max(1,Math.min(20,Number(row.places))):3,
  })).filter((row:any)=>validRaceKeys.has(row.raceKey));
  const courseRecords = (Array.isArray(settings?.course_records) ? settings.course_records : []).map((row:any)=>({
    raceKey:String(row?.race_key||'').trim(), name:String(row?.name||'').trim(), gender:String(row?.gender||'').trim(),
    time:String(row?.time||'').trim(), year:String(row?.year||'').trim(), team:String(row?.team||'').trim(),
  })).filter((row:any)=>validRaceKeys.has(row.raceKey)&&row.name&&row.time);

  const showEntryList = displayAllowed(settings, 'show_entry_list');
  let entries: any[] = [];
  let entriesUpdatedAt: string | null = null;
  if (showEntryList) {
    const er = await fetch(`${supabaseUrl}/rest/v1/event_entry_rosters?select=entries,source_updated_at&event_id=eq.${event.id}&limit=1`, { headers:h });
    if (er.ok) {
      const rows = await er.json();
      if (Array.isArray(rows) && rows.length) {
        const rawEntries = Array.isArray(rows[0]?.entries) ? rows[0].entries : [];
        entries = rawEntries.map((row:any)=>publicEntry(row, settings, awards));
        entriesUpdatedAt = typeof rows[0]?.source_updated_at === 'string' ? rows[0].source_updated_at : null;
      }
    }
  }

  const showRecentFinishers = displayAllowed(settings, 'show_recent_finishers');
  const recentFinishersDefaultCount = [5, 10, 15, 20].includes(Number(settings?.recent_finishers_default_count))
    ? Number(settings.recent_finishers_default_count)
    : 10;

  let recentFinishers: any[] = [];
  if (showRecentFinishers && results.length > 0) {
    const byRaceBib = new Map(
      rawResults.map((row: any) => [raceOf(row) + '\u0000' + String(publicScalar(row?.bib) ?? '').trim(), row]),
    );
    const recentRaceKeys = publicRaces.length ? publicRaces.map((r: any) => String(r.key)) : [''];
    const recentBatches = await Promise.all(recentRaceKeys.map(async (race: string) => {
      const raceFilter = race ? `&race=eq.${encodeURIComponent(race)}` : '&race=eq.';
      const recentRes = await fetch(
        `${supabaseUrl}/rest/v1/finisher_events?select=id,race,bib,detected_revision,detected_at&event_id=eq.${event.id}${raceFilter}&order=detected_at.desc,detected_revision.desc,id.desc&limit=20`,
        { headers: h },
      );
      if (!recentRes.ok) return [];
      const rows = await recentRes.json();
      return Array.isArray(rows) ? rows : [];
    }));

    for (const finisherEvents of recentBatches) {
      const used = new Set<string>();
      for (const activity of finisherEvents) {
        const race = String(activity?.race ?? '').trim();
        const bib = String(activity?.bib ?? '').trim();
        const key = race + '\u0000' + bib;
        if (!bib || used.has(key)) continue;
        const row = byRaceBib.get(key);
        if (!row) continue;
        used.add(key);
        recentFinishers.push({
          ...rankedPublicResult(row),
          detectedAt: publicScalar(activity.detected_at) ?? null,
          detectedRevision: publicScalar(activity.detected_revision) ?? null,
        });
      }
    }
  }

  return jsonResponse({
    schemaVersion: 15,
    serverTime: new Date().toISOString(),
    revision: snapshot?.revision ?? 0,
    updatedAt: snapshot?.source_updated_at ?? event.last_published_at ?? null,
    receivedAt: snapshot?.received_at ?? null,
    status: event.status,
    event: {
      slug: event.slug,
      name: event.name,
      location: event.location,
      date: dateLabel,
      startTime: event.start_time_label,
      distance: event.distance_label,
    },
    branding: {
      eventLogoUrl,
      eventLogoAlt: settings?.event_logo_alt ?? null,
      accentColor: settings?.accent_color ?? '#b30f2b',
    },
    display: {
      timezone: settings?.timezone ?? 'America/New_York',
      showOverallPlace: displayAllowed(settings, 'show_overall_place'),
      showBib: displayAllowed(settings, 'show_bib'),
      showName: displayAllowed(settings, 'show_name'),
      showGender: displayAllowed(settings, 'show_gender'),
      showAge: displayAllowed(settings, 'show_age'),
      showAgeGroup: displayAllowed(settings, 'show_age_group'),
      showGrade: displayAllowed(settings, 'show_grade'),
      gradeSource: ['grade','category','age','city'].includes(String(settings?.grade_source || '')) ? String(settings.grade_source) : 'grade',
      showTeam: displayAllowed(settings, 'show_team'),
      teamScoringEnabled: settings?.team_scoring?.enabled === true,
      showGunTime: displayAllowed(settings, 'show_gun_time'),
      showChipTime: displayAllowed(settings, 'show_chip_time'),
      showPace: displayAllowed(settings, 'show_pace'),
      showRecentFinishers,
      showEntryList,
      showPodium: podiumMode !== 'off',
      podiumMode,
      recentFinishersDefaultCount,
    },
    awards,
    courseRecords,
    podiumConfigs,
    featuredRaceKey,
    races: publicRaces,
    entriesUpdatedAt,
    entries,
    recentFinishers,
    results,
  });
});


