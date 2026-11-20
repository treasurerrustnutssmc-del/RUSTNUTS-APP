-- A rider on a live ride can call for fuel: calmer than an emergency, and they stay on the ride.
-- On its own so the new value is committed before anything uses it.
alter type public.ride_alert_kind add value if not exists 'fuel';
