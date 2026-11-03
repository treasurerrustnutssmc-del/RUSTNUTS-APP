// Retired: the one-off copy of the website's shop photos into the app ran on 2 Nov 2026.
// Kept here so every deployed function has its source in the repo (ChatGPT audit F12).
Deno.serve(() => new Response(JSON.stringify({ error: 'Retired. The shop photos were copied on 2 Nov 2026.' }), { status: 410, headers: { 'content-type': 'application/json' } }));
