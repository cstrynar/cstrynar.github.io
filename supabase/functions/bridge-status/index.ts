import {handler} from './handler.ts';
Deno.serve(handler(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!));
