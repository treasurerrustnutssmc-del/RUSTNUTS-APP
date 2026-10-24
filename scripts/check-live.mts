// Quick check that this build can reach the club database with the details in .env.
// Run: npm run check:live
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/data/database.types';
import { loadClub } from '../src/data/liveData';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const db = createClient<Database>(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

const data = await loadClub(db, false);
console.log(`Connected. Chapters visible to the public: ${data.chapters.map((c) => c.name).join(', ')}`);

// Signed-out visitors must not be able to read members.
const members = await db.from('members').select('id');
console.log(members.error ? `Members hidden from the public: yes (${members.error.code})` : `PROBLEM: public can read ${members.data.length} members`);
const phones = await db.rpc('shared_phones');
console.log(phones.error ? `Phone list hidden from the public: yes (${phones.error.code})` : 'PROBLEM: public can call shared_phones');
