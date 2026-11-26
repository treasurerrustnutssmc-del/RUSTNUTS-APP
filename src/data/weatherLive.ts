// The live ride weather source: the club's ride-weather server, falling back to the phone's own
// Open-Meteo. Kept apart from weather.ts so the rules there test without React Native.

import { serverSource, phoneSource, type ForecastSource } from './weather';
import { supabase } from './supabase';

export const liveSource: ForecastSource = serverSource(async (body) => {
  const { data, error } = await supabase().functions.invoke('ride-weather', { body });
  if (error) throw error;
  return data;
}, phoneSource);
