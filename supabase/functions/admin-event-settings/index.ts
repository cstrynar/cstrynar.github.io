const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-mercury-admin-key',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function zonedStartTimestamp(eventDate: string, timeOfDay: string, timeZone: string) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeOfDay);
  if (!dm || !tm) return null;
  const [year, month, day] = dm.slice(1).map(Number);
  const hour = Number(tm[1]), minute = Number(tm[2]), second = Number(tm[3] || '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
    });
  } catch { return null; }
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wanted;
  const partsAt = (value: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
    return {
      year:Number(parts.year), month:Number(parts.month), day:Number(parts.day),
      hour:Number(parts.hour), minute:Number(parts.minute), second:Number(parts.second),
    };
  };
  for (let i = 0; i < 4; i++) {
    const p = partsAt(guess);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = represented - wanted;
    if (diff === 0) break;
    guess -= diff;
  }
  const check = partsAt(guess);
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute || check.second !== second) return null;
  return new Date(guess).toISOString();
}

function normalizeScheduledStart(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]), second = Number(m[3] || '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}
function formatScheduledStart(value: unknown) {
  const normalized = normalizeScheduledStart(value);
  if (!normalized) return '';
  const [hourText, minute] = normalized.split(':');
  const hour24 = Number(hourText);
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${hour24 >= 12 ? 'PM' : 'AM'}`;
}
function raceSummaryLabel(races: Array<any>) {
  const labels = races.map((race: any) => String(race?.display_label || '').trim()).filter(Boolean);
  return labels.length ? labels.join(' + ') : null;
}

function scheduledStartLabel(races: Array<any>) {
  const scheduled = races.map((race: any) => ({
    scheduled_start_time: normalizeScheduledStart(race?.scheduled_start_time),
    display_label: String(race?.display_label || '').trim(),
  })).filter((race: any) => !!race.scheduled_start_time && !!race.display_label)
    .sort((a: any, b: any) => String(a.scheduled_start_time).localeCompare(String(b.scheduled_start_time)));
  const parts = scheduled.map((race: any) => `${race.display_label} ${formatScheduledStart(race.scheduled_start_time)}`);
  return parts.length ? parts.join(' · ') : null;
}

function normalizedTeamScoring(raw: any) {
  const ruleset = raw?.ruleset === 'usatf' ? 'usatf' : 'custom';
  const scorers = Math.min(20, Math.max(1, Number.parseInt(String(raw?.scorers_per_team ?? '5'), 10) || 5));
  const displacers = Math.min(20, Math.max(0, Number.parseInt(String(raw?.displacers_per_team ?? '2'), 10) || 0));
  const minCompleteTeams = Math.min(50, Math.max(1, Number.parseInt(String(raw?.min_complete_teams_to_publish ?? '3'), 10) || 3));
  const unattachedModes = ['skip_compress','count_in_sequence'];
  const divisionModes = ['all','gender','category','gender_category'];
  const tiebreakers = ['ncaa_head_to_head','nfhs_next_runner','aggregate_time','usatf_last_scorer'];
  return {
    enabled: raw?.enabled === true,
    ruleset,
    scorers_per_team: scorers,
    displacers_per_team: displacers,
    min_complete_teams_to_publish: minCompleteTeams,
    unattached_mode: unattachedModes.includes(raw?.unattached_mode) ? raw.unattached_mode : 'skip_compress',
    division_mode: divisionModes.includes(raw?.division_mode) ? raw.division_mode : 'all',
    tiebreaker: ruleset === 'usatf' ? 'usatf_last_scorer' : (tiebreakers.includes(raw?.tiebreaker) ? raw.tiebreaker : 'ncaa_head_to_head'),
  };
}

function encodedPath(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }
function base64Url(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function newActivationCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  let body = '';
  for (const b of raw) body += alphabet[b % alphabet.length];
  return 'MC-' + body.match(/.{1,4}/g)!.join('-');
}
function normalizeActivationCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'server_not_configured' }, 500);
  const serviceHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
  async function authorize() {
    const auth = req.headers.get('authorization') || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token) {
        const tokenHash = await sha256Hex(token);
        const now = new Date().toISOString();
        const sessionRes = await fetch(`${supabaseUrl}/rest/v1/admin_sessions?select=id,admin_client_id&token_hash=eq.${encodeURIComponent(tokenHash)}&expires_at=gt.${encodeURIComponent(now)}&limit=1`, { headers: serviceHeaders });
        if (sessionRes.ok) {
          const sessions = await sessionRes.json();
          if (Array.isArray(sessions) && sessions.length) {
            const adminRes = await fetch(`${supabaseUrl}/rest/v1/admin_clients?select=id,active&id=eq.${sessions[0].admin_client_id}&active=eq.true&limit=1`, { headers: serviceHeaders });
            if (adminRes.ok) {
              const admins = await adminRes.json();
              if (Array.isArray(admins) && admins.length) {
                fetch(`${supabaseUrl}/rest/v1/admin_sessions?id=eq.${sessions[0].id}`, { method: 'PATCH', headers: { ...serviceHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ last_used_at: now }) }).catch(() => {});
                return admins[0].id;
              }
            }
          }
        }
      }
    }
    const legacyKey = req.headers.get('x-mercury-admin-key') || '';
    if (legacyKey.length >= 24) {
      const keyHash = await sha256Hex(legacyKey);
      const adminRes = await fetch(`${supabaseUrl}/rest/v1/admin_clients?select=id&key_hash=eq.${keyHash}&active=eq.true&password_hash=is.null&limit=1`, { headers: serviceHeaders });
      if (adminRes.ok) {
        const admins = await adminRes.json();
        if (Array.isArray(admins) && admins.length) return admins[0].id;
      }
    }
    return null;
  }
  const adminId = await authorize();
  if (!adminId) return json({ error: 'unauthorized' }, 401);
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || '';
  const logActivity = async (actionName: string, detail: unknown = {}, eventId: string | null = null) => {
    await fetch(`${supabaseUrl}/rest/v1/event_admin_activity`, {
      method: 'POST', headers: { ...serviceHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: eventId, action: actionName, detail }),
    });
  };
  if (action === 'bridge-clients') {
    if (req.method === 'GET') {
      const r = await fetch(`${supabaseUrl}/rest/v1/bridge_clients?select=id,name,active,created_at,last_used_at&order=created_at.asc`, { headers: serviceHeaders });
      if (!r.ok) return json({ error: 'bridge_clients_lookup_failed' }, 500);
      return json({ clients: await r.json() });
    }
    if (req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const name = String(body?.name || '').trim();
      const activationMode = body?.activationMode === true;
      if (!name || name.length > 120) return json({ error: 'invalid_name' }, 400);
      const raw = new Uint8Array(32); crypto.getRandomValues(raw);
      const bridgeKey = `mb_${base64Url(raw)}`;
      const keyHash = await sha256Hex(bridgeKey);
      const r = await fetch(`${supabaseUrl}/rest/v1/bridge_clients`, {
        method: 'POST', headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ name, key_hash: keyHash, active: true }),
      });
      if (!r.ok) return json({ error: 'bridge_client_create_failed', detail: await r.text() }, 400);
      const rows = await r.json();
      const client = rows?.[0] || null;
      await logActivity('bridge_client_created', { name, client_id: client?.id || null, activation_mode: activationMode });
      if (!activationMode) return json({ ok: true, client, bridgeKey });

      const activationCode = newActivationCode();
      const codeHash = await sha256Hex(normalizeActivationCode(activationCode));
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const ar = await fetch(`${supabaseUrl}/rest/v1/bridge_activation_codes`, {
        method:'POST',
        headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=minimal' },
        body:JSON.stringify({ bridge_client_id:client.id, code_hash:codeHash, expires_at:expiresAt, created_by_admin:adminId }),
      });
      if (!ar.ok) {
        await fetch(`${supabaseUrl}/rest/v1/bridge_clients?id=eq.${client.id}`, { method:'DELETE', headers:serviceHeaders }).catch(() => {});
        return json({ error:'activation_code_create_failed' }, 500);
      }
      await logActivity('bridge_activation_code_created', { client_id:client.id, client_name:name, expires_at:expiresAt }, null);
      return json({ ok:true, client, activationCode, expiresAt });
    }
    if (req.method === 'PUT') {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const id = String(body?.id || '').trim();
      const active = body?.active === true;
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json({ error: 'invalid_id' }, 400);
      const r = await fetch(`${supabaseUrl}/rest/v1/bridge_clients?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ active }),
      });
      if (!r.ok) return json({ error: 'bridge_client_update_failed' }, 500);
      await logActivity('bridge_client_status_changed', { client_id: id, active });
      return json({ ok: true });
    }
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (action === 'bridge-activation') {
    if (req.method !== 'POST') return json({ error:'method_not_allowed' }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ error:'invalid_json' }, 400); }
    const clientId = String(body?.clientId || '').trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(clientId)) return json({ error:'invalid_client_id' }, 400);
    const clientRes = await fetch(`${supabaseUrl}/rest/v1/bridge_clients?select=id,name,active&id=eq.${encodeURIComponent(clientId)}&limit=1`, { headers:serviceHeaders });
    if (!clientRes.ok) return json({ error:'bridge_client_lookup_failed' }, 500);
    const clients = await clientRes.json();
    if (!Array.isArray(clients) || !clients.length) return json({ error:'bridge_client_not_found' }, 404);
    const client = clients[0];
    if (client.active !== true) return json({ error:'bridge_client_disabled' }, 409);

    const now = new Date().toISOString();
    await fetch(`${supabaseUrl}/rest/v1/bridge_activation_codes?bridge_client_id=eq.${encodeURIComponent(clientId)}&used_at=is.null`, {
      method:'PATCH',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({ used_at:now }),
    });

    const activationCode = newActivationCode();
    const codeHash = await sha256Hex(normalizeActivationCode(activationCode));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/bridge_activation_codes`, {
      method:'POST',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({ bridge_client_id:clientId, code_hash:codeHash, expires_at:expiresAt, created_by_admin:adminId }),
    });
    if (!insertRes.ok) return json({ error:'activation_code_create_failed' }, 500);
    await logActivity('bridge_activation_code_created', { client_id:clientId, client_name:client.name, expires_at:expiresAt }, null);
    return json({ ok:true, client:{ id:client.id, name:client.name }, activationCode, expiresAt });
  }
  if (action === 'create-event') {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const e = body?.event || {};
    const name = String(e.name || '').trim();
    const slug = String(e.slug || '').trim().toLowerCase();
    const location = String(e.location || '').trim();
    const eventDate = String(e.event_date || '').trim();
    const timezone = String(body?.timezone || 'America/New_York').trim();
    const accent = String(body?.accent_color || '#b30f2b').trim();
    const races = Array.isArray(body?.races) ? body.races : [];
    if (!name || name.length > 180) return json({ error: 'invalid_event_name' }, 400);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return json({ error: 'invalid_slug' }, 400);
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return json({ error: 'invalid_event_date' }, 400);
    if (!timezone || timezone.length > 100) return json({ error: 'invalid_timezone' }, 400);
    if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) return json({ error: 'invalid_accent_color' }, 400);
    if (races.length < 1 || races.length > 20) return json({ error: 'race_required' }, 400);
    const normalizedRaces: Array<{ source_label:string; race_key:string; display_label:string; scheduled_start_time:string|null; sort_order:number; active:boolean }> = [];
    const seenSource = new Set<string>(), seenKey = new Set<string>();
    for (let i = 0; i < races.length; i++) {
      const sourceLabel = String(races[i]?.source_label || '').trim();
      const raceKey = String(races[i]?.race_key || '').trim().toLowerCase();
      const displayLabel = String(races[i]?.display_label || '').trim();
      const scheduledRaw = String(races[i]?.scheduled_start_time || '').trim();
      const scheduledStart = normalizeScheduledStart(scheduledRaw);
      if (!sourceLabel || sourceLabel.length > 160) return json({ error: 'invalid_race_source_label', race: i + 1 }, 400);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raceKey) || raceKey.length > 80) return json({ error: 'invalid_race_key', race: i + 1 }, 400);
      if (!displayLabel || displayLabel.length > 80) return json({ error: 'invalid_race_display_label', race: i + 1 }, 400);
      if (scheduledRaw && !scheduledStart) return json({ error: 'invalid_race_scheduled_start', race: i + 1 }, 400);
      const sourceNorm = sourceLabel.toLowerCase();
      if (seenSource.has(sourceNorm)) return json({ error: 'duplicate_race_source_label', race: i + 1 }, 400);
      if (seenKey.has(raceKey)) return json({ error: 'duplicate_race_key', race: i + 1 }, 400);
      seenSource.add(sourceNorm); seenKey.add(raceKey);
      normalizedRaces.push({ source_label:sourceLabel, race_key:raceKey, display_label:displayLabel, scheduled_start_time:scheduledStart, sort_order:i, active:true });
    }
    const existingRes = await fetch(`${supabaseUrl}/rest/v1/live_events?select=id&slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: serviceHeaders });
    if (!existingRes.ok) return json({ error: 'event_lookup_failed' }, 500);
    const existing = await existingRes.json();
    if (Array.isArray(existing) && existing.length) return json({ error: 'slug_already_exists' }, 409);

    const generatedStartTimeLabel = scheduledStartLabel(normalizedRaces);
    const generatedDistanceLabel = raceSummaryLabel(normalizedRaces);
    const createdRes = await fetch(`${supabaseUrl}/rest/v1/live_events`, {
      method:'POST',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body:JSON.stringify({
        slug, name, location:location || null, event_date:eventDate || null,
        start_time_label:generatedStartTimeLabel, distance_label:generatedDistanceLabel,
        status:'setup', is_public:e.is_public === true, current_revision:0, last_published_at:null,
      }),
    });
    if (!createdRes.ok) return json({ error:'event_create_failed', detail:await createdRes.text() }, 400);
    const createdRows = await createdRes.json();
    const createdEvent = Array.isArray(createdRows) && createdRows.length ? createdRows[0] : null;
    if (!createdEvent?.id) return json({ error:'event_create_failed' }, 500);
    const eventId = String(createdEvent.id);
    const cleanup = async () => {
      for (const table of ['event_race_aliases','bridge_event_policies','event_settings']) {
        await fetch(`${supabaseUrl}/rest/v1/${table}?event_id=eq.${eventId}`, { method:'DELETE', headers:serviceHeaders }).catch(() => {});
      }
      await fetch(`${supabaseUrl}/rest/v1/live_events?id=eq.${eventId}`, { method:'DELETE', headers:serviceHeaders }).catch(() => {});
    };

    const settingsRes = await fetch(`${supabaseUrl}/rest/v1/event_settings`, {
      method:'POST',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({ event_id:eventId, timezone, accent_color:accent, featured_race_key:normalizedRaces[0]?.race_key || null }),
    });
    if (!settingsRes.ok) { await cleanup(); return json({ error:'event_settings_create_failed' }, 500); }

    const policyRes = await fetch(`${supabaseUrl}/rest/v1/bridge_event_policies`, {
      method:'POST',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({ event_id:eventId, require_lease:true }),
    });
    if (!policyRes.ok) { await cleanup(); return json({ error:'event_policy_create_failed' }, 500); }

    const aliasesRes = await fetch(`${supabaseUrl}/rest/v1/event_race_aliases`, {
      method:'POST',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body:JSON.stringify(normalizedRaces.map(r => ({ ...r, event_id:eventId }))),
    });
    if (!aliasesRes.ok) { const detail=await aliasesRes.text(); await cleanup(); return json({ error:'race_alias_create_failed', detail }, 500); }
    const aliases = await aliasesRes.json();
    await logActivity('event_created', {
      slug, name, race_count: normalizedRaces.length, is_public: e.is_public === true,
      require_lease:true, current_revision:0,
    }, eventId);
    return json({ ok:true, event:createdEvent, raceAliases:Array.isArray(aliases)?aliases:[] });
  }

  if (action === 'events' && req.method === 'GET') {
    const r = await fetch(`${supabaseUrl}/rest/v1/live_events?select=id,slug,name,location,event_date,start_time_label,distance_label,status,is_public,current_revision,last_published_at&order=event_date.desc.nullslast,name.asc`, { headers: serviceHeaders });
    if (!r.ok) return json({ error: 'events_lookup_failed' }, 500);
    return json({ events: await r.json() });
  }
  const slug = (url.searchParams.get('slug') || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: 'invalid_slug' }, 400);
  const eventRes = await fetch(`${supabaseUrl}/rest/v1/live_events?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: serviceHeaders });
  if (!eventRes.ok) return json({ error: 'event_lookup_failed' }, 500);
  const events = await eventRes.json();
  if (!Array.isArray(events) || events.length === 0) return json({ error: 'not_found' }, 404);
  const event = events[0];
  const getSettings = async () => {
    const r = await fetch(`${supabaseUrl}/rest/v1/event_settings?select=*&event_id=eq.${event.id}&limit=1`, { headers: serviceHeaders });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };
  const getRaceAliases = async () => {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/event_race_aliases?select=id,source_label,race_key,display_label,scheduled_start_time,sort_order,active,running_clock_enabled,running_clock_start_at,running_clock_source&event_id=eq.${event.id}&active=eq.true&order=sort_order.asc,id.asc`,
      { headers: serviceHeaders },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  };
  if (action === 'race-alias') {
    if (req.method !== 'POST') return json({ error:'method_not_allowed' }, 405);
    if (Number(event.current_revision || 0) !== 0 || event.last_published_at) {
      return json({ error:'event_structure_locked_after_publish' }, 409);
    }
    if (!['setup','shadow'].includes(String(event.status || ''))) {
      return json({ error:'event_structure_locked_for_status', status:event.status }, 409);
    }
    let body: any;
    try { body = await req.json(); } catch { return json({ error:'invalid_json' }, 400); }
    const sourceLabel = String(body?.source_label || '').trim();
    const raceKey = String(body?.race_key || '').trim().toLowerCase();
    const displayLabel = String(body?.display_label || '').trim();
    const scheduledRaw = String(body?.scheduled_start_time || '').trim();
    const scheduledStart = normalizeScheduledStart(scheduledRaw);
    if (!sourceLabel || sourceLabel.length > 160) return json({ error:'invalid_race_source_label' }, 400);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raceKey) || raceKey.length > 80) return json({ error:'invalid_race_key' }, 400);
    if (!displayLabel || displayLabel.length > 80) return json({ error:'invalid_race_display_label' }, 400);
    if (scheduledRaw && !scheduledStart) return json({ error:'invalid_race_scheduled_start' }, 400);

    const existingAliases = await getRaceAliases();
    if (existingAliases === null) return json({ error:'race_alias_lookup_failed' }, 500);
    if (existingAliases.some((row: any) => String(row.source_label || '').trim().toLowerCase() === sourceLabel.toLowerCase())) {
      return json({ error:'duplicate_race_source_label' }, 409);
    }
    if (existingAliases.some((row: any) => String(row.race_key || '').trim().toLowerCase() === raceKey)) {
      return json({ error:'duplicate_race_key' }, 409);
    }
    const maxSort = existingAliases.reduce((m: number, row: any) => Math.max(m, Number(row.sort_order || 0)), -10);
    const sortOrder = maxSort + 10;
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/event_race_aliases`, {
      method:'POST',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
      body:JSON.stringify({
        event_id:event.id,
        source_label:sourceLabel,
        race_key:raceKey,
        display_label:displayLabel,
        scheduled_start_time:scheduledStart,
        sort_order:sortOrder,
        active:true,
        running_clock_enabled:false,
        running_clock_start_at:null,
        running_clock_source:null,
      }),
    });
    if (!insertRes.ok) return json({ error:'race_alias_create_failed', detail:await insertRes.text() }, 400);
    const insertedRows = await insertRes.json();
    const inserted = Array.isArray(insertedRows) && insertedRows.length ? insertedRows[0] : null;
    const allAliases = [...existingAliases, inserted].filter(Boolean).sort((a:any,b:any)=>Number(a.sort_order||0)-Number(b.sort_order||0)||Number(a.id||0)-Number(b.id||0));
    const eventUpdate = await fetch(`${supabaseUrl}/rest/v1/live_events?id=eq.${event.id}`, {
      method:'PATCH',
      headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:JSON.stringify({
        start_time_label:scheduledStartLabel(allAliases),
        distance_label:raceSummaryLabel(allAliases),
        updated_at:new Date().toISOString(),
      }),
    });
    if (!eventUpdate.ok) {
      if (inserted?.id) await fetch(`${supabaseUrl}/rest/v1/event_race_aliases?id=eq.${inserted.id}&event_id=eq.${event.id}`, { method:'DELETE', headers:serviceHeaders }).catch(()=>{});
      return json({ error:'event_summary_update_failed' }, 500);
    }
    await logActivity('race_added', {
      race_alias_id:inserted?.id ?? null,
      source_label:sourceLabel,
      race_key:raceKey,
      display_label:displayLabel,
      scheduled_start_time:scheduledStart,
    }, event.id);
    return json({ ok:true, raceAlias:inserted });
  }

  if (action === 'race-source-map') {
    if (req.method !== 'POST') return json({ error:'method_not_allowed' }, 405);
    if (!['setup','shadow','live'].includes(String(event.status || ''))) {
      return json({ error:'race_source_mapping_locked_for_status', status:event.status }, 409);
    }
    let body:any;
    try { body = await req.json(); } catch { return json({ error:'invalid_json' }, 400); }
    const raceAliasId = Number(body?.raceAliasId);
    const sourceLabel = String(body?.sourceLabel || '').trim();
    if (!Number.isInteger(raceAliasId) || raceAliasId <= 0) return json({ error:'invalid_race_alias_id' }, 400);
    if (!sourceLabel || sourceLabel.length > 160) return json({ error:'invalid_race_source_label' }, 400);

    const aliases = await getRaceAliases();
    if (aliases === null) return json({ error:'race_alias_lookup_failed' }, 500);
    const target = aliases.find((row:any)=>Number(row.id)===raceAliasId);
    if (!target) return json({ error:'race_alias_not_found' }, 404);

    const raceNorm = (value: unknown) => String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[‐‑‒–—−_]+/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    const wanted = raceNorm(sourceLabel);
    const duplicate = aliases.find((row:any)=>Number(row.id)!==raceAliasId && raceNorm(row.source_label)===wanted);
    if (duplicate) return json({ error:'duplicate_race_source_label' }, 409);

    const updateRes = await fetch(
      supabaseUrl + '/rest/v1/event_race_aliases?id=eq.' + raceAliasId + '&event_id=eq.' + event.id,
      {
        method:'PATCH',
        headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
        body:JSON.stringify({ source_label:sourceLabel, updated_at:new Date().toISOString() }),
      },
    );
    if (!updateRes.ok) return json({ error:'race_source_mapping_failed' }, 500);
    const updatedRows = await updateRes.json();
    const updated = Array.isArray(updatedRows) && updatedRows.length ? updatedRows[0] : null;
    await logActivity('race_source_mapped', {
      race_alias_id:raceAliasId,
      race_key:target.race_key,
      old_source_label:target.source_label,
      source_label:sourceLabel,
    }, event.id);
    return json({ ok:true, raceAlias:updated });
  }

  if (action === 'race-clock') {
    if (req.method !== 'POST') return json({ error:'method_not_allowed' }, 405);
    let body: any;
    try { body = await req.json(); } catch { return json({ error:'invalid_json' }, 400); }
    const raceAliasId = Number(body?.raceAliasId);
    const mode = String(body?.mode || '').trim();
    if (!Number.isInteger(raceAliasId) || raceAliasId < 1) return json({ error:'invalid_race_alias' }, 400);
    if (!['start','now','manual','hide','clear'].includes(mode)) return json({ error:'invalid_clock_mode' }, 400);

    const aliasRes = await fetch(
      `${supabaseUrl}/rest/v1/event_race_aliases?select=id,race_key,display_label,running_clock_enabled,running_clock_start_at,running_clock_source&id=eq.${raceAliasId}&event_id=eq.${event.id}&active=eq.true&limit=1`,
      { headers:serviceHeaders },
    );
    if (!aliasRes.ok) return json({ error:'race_alias_lookup_failed' }, 500);
    const aliases = await aliasRes.json();
    if (!Array.isArray(aliases) || aliases.length === 0) return json({ error:'race_alias_not_found' }, 404);
    const alias = aliases[0];
    const patch: Record<string, unknown> = { updated_at:new Date().toISOString() };

    if (mode === 'start') {
      const offsetSeconds = Number(body?.offsetSeconds ?? 0);
      if (!Number.isFinite(offsetSeconds) || offsetSeconds < 0 || offsetSeconds > 172800) return json({ error:'invalid_clock_offset' }, 400);
      patch.running_clock_enabled = true;
      patch.running_clock_start_at = new Date(Date.now() - Math.round(offsetSeconds * 1000)).toISOString();
      patch.running_clock_source = 'push';
    } else if (mode === 'now') {
      patch.running_clock_enabled = true;
      patch.running_clock_start_at = new Date().toISOString();
      patch.running_clock_source = 'admin_now';
    } else if (mode === 'manual') {
      const settings = await getSettings();
      const timezone = String(settings?.timezone || 'America/New_York').trim();
      const timeOfDay = String(body?.timeOfDay || '').trim();
      if (!event.event_date) return json({ error:'event_date_required_for_manual_clock' }, 409);
      const startAt = zonedStartTimestamp(String(event.event_date), timeOfDay, timezone);
      if (!startAt) return json({ error:'invalid_clock_time_or_timezone' }, 400);
      if (Date.parse(startAt) > Date.now() + 5000) return json({ error:'gun_time_is_in_future' }, 409);
      patch.running_clock_enabled = true;
      patch.running_clock_start_at = startAt;
      patch.running_clock_source = 'manual';
    } else if (mode === 'hide') {
      patch.running_clock_enabled = false;
    } else {
      patch.running_clock_enabled = false;
      patch.running_clock_start_at = null;
      patch.running_clock_source = null;
    }

    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/event_race_aliases?id=eq.${raceAliasId}&event_id=eq.${event.id}`,
      {
        method:'PATCH',
        headers:{ ...serviceHeaders, 'Content-Type':'application/json', Prefer:'return=representation' },
        body:JSON.stringify(patch),
      },
    );
    if (!updateRes.ok) return json({ error:'race_clock_update_failed' }, 500);
    const updatedRows = await updateRes.json();
    const updated = Array.isArray(updatedRows) && updatedRows.length ? updatedRows[0] : null;
    await logActivity('race_clock_updated', {
      race_alias_id:raceAliasId,
      race_key:alias.race_key,
      mode,
      enabled:updated?.running_clock_enabled === true,
      start_at:updated?.running_clock_start_at ?? null,
      source:updated?.running_clock_source ?? null,
    }, event.id);
    return json({ ok:true, raceClock:updated });
  }

  if (action === 'bridge-access') {
    if (req.method === 'GET') {
      const [clientsRes, grantsRes, policyRes, leaseRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/bridge_clients?select=id,name,active,created_at,last_used_at&order=created_at.asc`, { headers: serviceHeaders }),
        fetch(`${supabaseUrl}/rest/v1/bridge_event_grants?select=bridge_client_id,can_read,can_publish,active,updated_at&event_id=eq.${event.id}`, { headers: serviceHeaders }),
        fetch(`${supabaseUrl}/rest/v1/bridge_event_policies?select=require_lease&event_id=eq.${event.id}&limit=1`, { headers: serviceHeaders }),
        fetch(`${supabaseUrl}/rest/v1/bridge_writer_leases?select=bridge_client_id,acquired_at,last_renewed_at,expires_at&event_id=eq.${event.id}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`, { headers: serviceHeaders }),
      ]);
      if (!clientsRes.ok || !grantsRes.ok || !policyRes.ok || !leaseRes.ok) return json({ error: 'bridge_access_lookup_failed' }, 500);
      const clients = await clientsRes.json();
      const grants = await grantsRes.json();
      const policies = await policyRes.json();
      const leases = await leaseRes.json();
      const byClient = new Map((Array.isArray(grants) ? grants : []).map((g: any) => [String(g.bridge_client_id), g]));
      const safeClients = (Array.isArray(clients) ? clients : []).map((c: any) => {
        const grant = byClient.get(String(c.id));
        return {
          id: c.id,
          name: c.name,
          active: c.active === true,
          created_at: c.created_at ?? null,
          last_used_at: c.last_used_at ?? null,
          grant: {
            active: grant?.active === true,
            can_read: grant?.active === true && grant?.can_read === true,
            can_publish: grant?.active === true && grant?.can_publish === true,
            updated_at: grant?.updated_at ?? null,
          },
        };
      });
      const lease = Array.isArray(leases) && leases.length ? leases[0] : null;
      const leaseClient = lease ? safeClients.find((c: any) => String(c.id) === String(lease.bridge_client_id)) : null;
      return json({
        event: { id: event.id, slug: event.slug, name: event.name, status: event.status, is_public: event.is_public === true, current_revision: event.current_revision },
        policy: { require_lease: Array.isArray(policies) && policies.length ? policies[0].require_lease === true : false },
        lease: lease ? { ...lease, client_name: leaseClient?.name || null } : null,
        clients: safeClients,
      });
    }
    if (req.method === 'PUT') {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      const clientId = String(body?.clientId || '').trim();
      const canRead = body?.canRead === true;
      const canPublish = body?.canPublish === true;
      if (!/^[0-9a-fA-F-]{36}$/.test(clientId)) return json({ error: 'invalid_client_id' }, 400);
      if (canPublish && !canRead) return json({ error: 'publish_requires_read' }, 400);
      const clientRes = await fetch(`${supabaseUrl}/rest/v1/bridge_clients?select=id,name,active&id=eq.${encodeURIComponent(clientId)}&limit=1`, { headers: serviceHeaders });
      if (!clientRes.ok) return json({ error: 'bridge_client_lookup_failed' }, 500);
      const clientRows = await clientRes.json();
      if (!Array.isArray(clientRows) || !clientRows.length) return json({ error: 'bridge_client_not_found' }, 404);
      const targetClient = clientRows[0];
      if (!canRead && !canPublish) {
        const removed = await fetch(`${supabaseUrl}/rest/v1/bridge_event_grants?bridge_client_id=eq.${encodeURIComponent(clientId)}&event_id=eq.${event.id}`, {
          method: 'DELETE', headers: { ...serviceHeaders, Prefer: 'return=minimal' },
        });
        if (!removed.ok) return json({ error: 'bridge_access_update_failed' }, 500);
      } else {
        const grantRow = {
          bridge_client_id: clientId,
          event_id: event.id,
          can_read: canRead,
          can_publish: canPublish,
          active: true,
          updated_at: new Date().toISOString(),
        };
        const saved = await fetch(`${supabaseUrl}/rest/v1/bridge_event_grants?on_conflict=bridge_client_id,event_id`, {
          method: 'POST',
          headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(grantRow),
        });
        if (!saved.ok) return json({ error: 'bridge_access_update_failed', detail: await saved.text() }, 500);
      }
      await logActivity('bridge_event_access_changed', {
        client_id: clientId,
        client_name: targetClient.name,
        can_read: canRead,
        can_publish: canPublish,
      }, event.id);
      return json({ ok: true, clientId, canRead, canPublish });
    }
    return json({ error: 'method_not_allowed' }, 405);
  }

  if (req.method === 'GET') {
    const [settings, raceAliases] = await Promise.all([getSettings(), getRaceAliases()]);
    if (raceAliases === null) return json({ error: 'race_alias_lookup_failed' }, 500);

    const raceNorm = (value: unknown) => String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[‐‑‒–—−_]+/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    const known = new Set<string>();
    for (const row of raceAliases) {
      const source = raceNorm(row?.source_label);
      const key = raceNorm(row?.race_key);
      if (source) known.add(source);
      if (key) known.add(key);
    }

    const detected = new Map<string, { label:string; count:number }>();
    if (Number(event.current_revision || 0) > 0) {
      const snapshotRes = await fetch(
        supabaseUrl + '/rest/v1/result_snapshots?select=payload&event_id=eq.' + event.id + '&revision=eq.' + event.current_revision + '&limit=1',
        { headers: serviceHeaders },
      );
      if (snapshotRes.ok) {
        const snapshots = await snapshotRes.json();
        const results = Array.isArray(snapshots) && snapshots.length && Array.isArray(snapshots[0]?.payload?.results)
          ? snapshots[0].payload.results : [];
        for (const result of results) {
          const label = String(result?.race ?? result?.category ?? '').trim();
          if (!label) continue;
          const normalized = raceNorm(label);
          const existing = detected.get(normalized);
          if (existing) existing.count += 1;
          else detected.set(normalized, { label, count:1 });
        }
      }
    }
    const detectedRaces = [...detected.values()].sort((a,b) => a.label.localeCompare(b.label));
    const unmappedRaces = detectedRaces.filter(row => !known.has(raceNorm(row.label)));
    return json({ event, settings, raceAliases, raceMapping:{ detectedRaces, unmappedRaces } });
  }
  if (req.method === 'PUT' && !action) {
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const e = body?.event || {}; const s = body?.settings || {}; const existingSettings = await getSettings();
    const requestedRaceAliases = Array.isArray(body?.raceAliases) ? body.raceAliases : null;
    const existingRaceAliases = await getRaceAliases();
    if (existingRaceAliases === null) return json({ error: 'race_alias_lookup_failed' }, 500);
    let validatedRaceAliases: Array<{ id: number; source_label: string; display_label: string; scheduled_start_time: string|null }> = [];
    if (requestedRaceAliases) {
      const allowedById = new Map(existingRaceAliases.map((row: any) => [Number(row.id), row]));
      const seen = new Set<number>();
      const sourceEditable = ['setup','shadow','live'].includes(String(event.status || ''));
      for (const raw of requestedRaceAliases) {
        const id = Number(raw?.id);
        const existingAlias = allowedById.get(id);
        const sourceLabel = String(raw?.source_label ?? existingAlias?.source_label ?? '').trim();
        const displayLabel = String(raw?.display_label ?? '').trim();
        const scheduledRaw = String(raw?.scheduled_start_time ?? '').trim();
        const scheduledStart = normalizeScheduledStart(scheduledRaw);
        if (!Number.isInteger(id) || !existingAlias || seen.has(id)) return json({ error: 'invalid_race_alias' }, 400);
        if (!sourceLabel || sourceLabel.length > 160) return json({ error: 'invalid_race_source_label' }, 400);
        if (!displayLabel || displayLabel.length > 80) return json({ error: 'invalid_race_display_label' }, 400);
        if (scheduledRaw && !scheduledStart) return json({ error: 'invalid_race_scheduled_start' }, 400);
        if (sourceLabel !== String(existingAlias.source_label || '').trim() && !sourceEditable) return json({ error:'race_source_label_locked' }, 409);
        seen.add(id);
        validatedRaceAliases.push({ id, source_label: sourceLabel, display_label: displayLabel, scheduled_start_time: scheduledStart });
      }
      const prospective = new Map(existingRaceAliases.map((row:any)=>[Number(row.id),String(row.source_label||'').trim()]));
      for (const row of validatedRaceAliases) prospective.set(row.id,row.source_label);
      const normalizedSources = [...prospective.values()].map(v=>v.toLowerCase());
      if (new Set(normalizedSources).size !== normalizedSources.length) return json({ error:'duplicate_race_source_label' }, 409);
    }
    const allowedStatus = ['setup','shadow','live','finished','official','archived'];
    const eventPatch: Record<string, unknown> = {};
    if (typeof e.name === 'string' && e.name.trim()) eventPatch.name = e.name.trim();
    if (typeof e.location === 'string') eventPatch.location = e.location.trim() || null;
    if (typeof e.event_date === 'string') eventPatch.event_date = e.event_date || null;
    if (requestedRaceAliases) {
      eventPatch.start_time_label = scheduledStartLabel(validatedRaceAliases);
      eventPatch.distance_label = raceSummaryLabel(validatedRaceAliases);
    }
    if (allowedStatus.includes(e.status)) eventPatch.status = e.status;
    if (typeof e.is_public === 'boolean') eventPatch.is_public = e.is_public;
    eventPatch.updated_at = new Date().toISOString();
    if (Object.keys(eventPatch).length) {
      const r = await fetch(`${supabaseUrl}/rest/v1/live_events?id=eq.${event.id}`, { method: 'PATCH', headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(eventPatch) });
      if (!r.ok) return json({ error: 'event_update_failed' }, 500);
    }
    const accent = typeof s.accent_color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s.accent_color) ? s.accent_color : '#b30f2b';
    const requestedRecentCount = Number(s.recent_finishers_default_count || 10);
    const podiumModes = ['featured','custom','off'];
    const podiumMode = podiumModes.includes(String(s.podium_mode || ''))
      ? String(s.podium_mode)
      : (s.show_podium === false ? 'off' : (podiumModes.includes(String(existingSettings?.podium_mode || '')) ? String(existingSettings.podium_mode) : 'featured'));
    const showPodium = podiumMode !== 'off';
    const showGrade = s.show_grade === true;
    const gradeSources = ['grade','category','age','city'];
    const gradeSource = gradeSources.includes(String(s.grade_source || '')) ? String(s.grade_source) : (gradeSources.includes(String(existingSettings?.grade_source || '')) ? String(existingSettings.grade_source) : 'grade');
    const rawCourseRecords = Array.isArray(s.course_records) ? s.course_records : (Array.isArray(existingSettings?.course_records) ? existingSettings.course_records : []);
    if (rawCourseRecords.length > 100) return json({ error:'too_many_course_records' }, 400);
    const validRaceKeys = new Set(existingRaceAliases.map((row:any)=>String(row?.race_key||'').trim()).filter(Boolean));
    const rawPodiumConfigs = Array.isArray(s.podium_configs) ? s.podium_configs : (Array.isArray(existingSettings?.podium_configs) ? existingSettings.podium_configs : []);
    if (rawPodiumConfigs.length > 20) return json({ error:'too_many_podium_configs' }, 400);
    const podiumConfigs:any[] = [];
    for (let i=0;i<rawPodiumConfigs.length;i++) {
      const row=rawPodiumConfigs[i]||{};
      const race_key=String(row.race_key||'').trim(),gender=String(row.gender||'').trim(),places=Number(row.places);
      if (!validRaceKeys.has(race_key)) return json({ error:'invalid_podium_race', podium:i+1 }, 400);
      if (!['Male','Female','Both'].includes(gender)) return json({ error:'invalid_podium_gender', podium:i+1 }, 400);
      if (!Number.isInteger(places) || places<1 || places>20) return json({ error:'invalid_podium_places', podium:i+1 }, 400);
      podiumConfigs.push({ race_key,gender,places });
    }
    if (podiumMode==='custom' && podiumConfigs.length<1) return json({ error:'custom_podium_required' }, 400);
    const courseRecords:any[] = [];
    for (let i=0;i<rawCourseRecords.length;i++) {
      const row=rawCourseRecords[i]||{};
      const race_key=String(row.race_key||'').trim(),name=String(row.name||'').trim(),gender=String(row.gender||'').trim(),time=String(row.time||'').trim(),year=String(row.year||'').trim(),team=String(row.team||'').trim();
      if (!validRaceKeys.has(race_key)) return json({ error:'invalid_course_record_race', record:i+1 }, 400);
      if (!name || name.length>160 || !time || time.length>40 || gender.length>40 || year.length>20 || team.length>160) return json({ error:'invalid_course_record', record:i+1 }, 400);
      courseRecords.push({ race_key,name,gender,time,year,team });
    }
    const requestedFeaturedRaceKey = String(s.featured_race_key ?? existingSettings?.featured_race_key ?? '').trim();
    const featuredRaceKey = requestedFeaturedRaceKey || String(existingRaceAliases[0]?.race_key || '').trim();
    if (featuredRaceKey && !existingRaceAliases.some((row:any)=>String(row?.race_key||'').trim()===featuredRaceKey)) {
      return json({ error:'invalid_featured_race_key' }, 400);
    }
    const settingsRow = {
      event_id:event.id, timezone:typeof s.timezone==='string'&&s.timezone.trim()?s.timezone.trim():'America/New_York', show_gun_time:s.show_gun_time!==false, show_chip_time:s.show_chip_time!==false, show_pace:s.show_pace!==false, accent_color:accent,
      show_overall_place:s.show_overall_place!==false, show_bib:s.show_bib!==false, show_name:s.show_name!==false, show_gender:s.show_gender!==false, show_age:s.show_age===true, show_age_group:s.show_age_group!==false, show_grade:showGrade, grade_source:gradeSource, show_team:s.show_team===true,
      show_entry_list:s.show_entry_list===true, show_podium:showPodium, podium_mode:podiumMode, podium_configs:podiumConfigs,
      show_recent_finishers:s.show_recent_finishers!==false, recent_finishers_default_count:[5,10,15,20].includes(requestedRecentCount)?requestedRecentCount:10,
      featured_race_key:featuredRaceKey || null, course_records:courseRecords,
      awards:typeof s.awards==='object'&&s.awards?s.awards:{overall_places:3,remove_overall_from_age_groups:true,age_groups:[],special_divisions:[]}, team_scoring:(s.team_scoring && typeof s.team_scoring==='object') ? normalizedTeamScoring(s.team_scoring) : (existingSettings?.team_scoring ?? normalizedTeamScoring(null)), event_logo_alt:typeof s.event_logo_alt==='string'?s.event_logo_alt.trim()||null:(existingSettings?.event_logo_alt ?? null), updated_at:new Date().toISOString(),
    };
    const sr = await fetch(`${supabaseUrl}/rest/v1/event_settings?on_conflict=event_id`, { method: 'POST', headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(settingsRow) });
    if (!sr.ok) return json({ error: 'settings_update_failed' }, 500);
    for (const alias of validatedRaceAliases) {
      const ar = await fetch(
        `${supabaseUrl}/rest/v1/event_race_aliases?id=eq.${alias.id}&event_id=eq.${event.id}`,
        {
          method: 'PATCH',
          headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ source_label: alias.source_label, display_label: alias.display_label, scheduled_start_time: alias.scheduled_start_time, updated_at: new Date().toISOString() }),
        },
      );
      if (!ar.ok) return json({ error: 'race_alias_update_failed' }, 500);
    }
    await logActivity('settings_saved', { fields:Object.keys(settingsRow).filter(k=>k!=='event_id') }, event.id);
    if (validatedRaceAliases.length) {
      await logActivity('race_settings_saved', { count: validatedRaceAliases.length, scheduled_starts: validatedRaceAliases.filter(r => !!r.scheduled_start_time).length }, event.id);
    }
    return json({ ok:true });
  }
  if (req.method === 'POST' && action === 'sponsor') {
    let form: FormData, input: any;
    try { form = await req.formData(); input = JSON.parse(String(form.get('sponsor'))); } catch { return json({error:'invalid_form'},400); }
    if (!Array.isArray(input?.items) || input.items.length < 1 || input.items.length > 3) return json({error:'Choose 1, 2 or 3 sponsors.'},400);
    const existing = await getSettings();
    if (!existing) return json({error:'settings_lookup_failed'},500);
    const items: any[] = [], files: any[] = [];
    for (let i=0;i<input.items.length;i++) {
      const raw=input.items[i], name=String(raw?.name||'').trim(), website=String(raw?.website||'').trim(), alt=String(raw?.alt||'').trim();
      if (name.length>100 || website.length>2048 || alt.length>160) return json({error:'sponsor_text_too_long'},400);
      if (website) { try { const u=new URL(website); if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error(); } catch { return json({error:'invalid_sponsor_website'},400); } }
      const file=form.get('file'+i);
      if(file instanceof File && file.size) {
        const ext=new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp']]).get(file.type);
        if(!ext||file.size>2*1024*1024)return json({error:'Choose a PNG, JPEG or WebP logo under 2 MB.'},400);
        const bytes=new Uint8Array(await file.arrayBuffer());
        const valid=ext==='png'?[137,80,78,71,13,10,26,10].every((v,j)=>bytes[j]===v):ext==='jpg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
        if(!valid)return json({error:'invalid_logo_image'},400);
        files[i]={bytes,type:file.type,path:`${event.id}/sponsor-${crypto.randomUUID()}.${ext}`};
      }
      const logoPath=files[i]?.path || (raw?.removeLogo===true?null:existing.sponsor?.items?.[i]?.logoPath||null);
      if(!name && !logoPath)return json({error:`Sponsor ${i+1} needs a name or logo.`},400);
      items.push({name,website,alt,logoPath});
    }
    const uploaded: string[]=[];
    const cleanup=async()=>{for(const path of uploaded)await fetch(`${supabaseUrl}/storage/v1/object/event-assets/${encodedPath(path)}`,{method:'DELETE',headers:serviceHeaders});};
    for(const file of files.filter(Boolean)) {
      const upload=await fetch(`${supabaseUrl}/storage/v1/object/event-assets/${encodedPath(file.path)}`,{method:'POST',headers:{...serviceHeaders,'Content-Type':file.type},body:file.bytes});
      if(!upload.ok){await cleanup();return json({error:'sponsor_upload_failed'},500);}uploaded.push(file.path);
    }
    const sponsor={items,top:input.top===true,bottom:input.bottom===true,print:input.print===true};
    const saved=await fetch(`${supabaseUrl}/rest/v1/event_settings?event_id=eq.${event.id}`,{method:'PATCH',headers:{...serviceHeaders,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({sponsor,updated_at:new Date().toISOString()})});
    if(!saved.ok || !(await saved.json()).length){await cleanup();return json({error:'sponsor_save_failed'},500);}
    await logActivity('sponsors_saved',{count:items.length,top:sponsor.top,bottom:sponsor.bottom},event.id);
    return json({ok:true,sponsor});
  }
  if (req.method === 'POST' && action === 'logo') {
    const form = await req.formData(); const file = form.get('file');
    if (!(file instanceof File)) return json({ error:'file_required' },400);
    const allowed = new Map([['image/png','png'],['image/jpeg','jpg'],['image/webp','webp'],['image/svg+xml','svg']]);
    const ext = allowed.get(file.type); if (!ext) return json({ error:'unsupported_file_type' },400); if (file.size > 5*1024*1024) return json({ error:'file_too_large' },400);
    const path = `${event.id}/event-logo.${ext}`;
    const upload = await fetch(`${supabaseUrl}/storage/v1/object/event-assets/${encodedPath(path)}`, { method:'POST', headers:{ ...serviceHeaders,'Content-Type':file.type,'x-upsert':'true' }, body:file });
    if (!upload.ok) return json({ error:'upload_failed',detail:await upload.text() },500);
    const alt = String(form.get('alt') || `${event.name} logo`).trim();
    const sr = await fetch(`${supabaseUrl}/rest/v1/event_settings?on_conflict=event_id`, { method:'POST', headers:{ ...serviceHeaders,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify({ event_id:event.id,event_logo_path:path,event_logo_alt:alt,updated_at:new Date().toISOString() }) });
    if (!sr.ok) return json({ error:'logo_settings_update_failed' },500);
    await logActivity('event_logo_uploaded',{ path,mime_type:file.type,size:file.size },event.id);
    return json({ ok:true,path,publicUrl:`${supabaseUrl}/storage/v1/object/public/event-assets/${encodedPath(path)}` });
  }
  if (req.method === 'DELETE' && action === 'logo') {
    const settings = await getSettings(); const path = settings?.event_logo_path ? String(settings.event_logo_path) : '';
    if (path) await fetch(`${supabaseUrl}/storage/v1/object/event-assets/${encodedPath(path)}`, { method:'DELETE',headers:serviceHeaders });
    const sr = await fetch(`${supabaseUrl}/rest/v1/event_settings?event_id=eq.${event.id}`, { method:'PATCH', headers:{ ...serviceHeaders,'Content-Type':'application/json',Prefer:'return=minimal' }, body:JSON.stringify({ event_logo_path:null,event_logo_alt:null,updated_at:new Date().toISOString() }) });
    if (!sr.ok) return json({ error:'logo_remove_failed' },500);
    await logActivity('event_logo_removed',{},event.id); return json({ ok:true });
  }
  return json({ error:'method_not_allowed' },405);
});

