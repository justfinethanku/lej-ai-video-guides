// A minimal server-side PostgREST call with the service-role key. Server code only: never ship this key to a browser.
export async function rest<T>(path: string): Promise<T> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server");
  const res = await fetch(`${url}/rest/v1/${path}`, { cache: "no-store", headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${res.status} ${path} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}
