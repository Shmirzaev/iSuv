-- A custom-format pg_restore deliberately starts with an empty search_path.
-- Keep the stored coordinate validator restore-safe by binding every PostGIS
-- dependency explicitly instead of relying on a session search path.
CREATE OR REPLACE FUNCTION public.network_wgs84_coordinates_in_bounds(candidate public.geometry)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.ST_DumpPoints(candidate) AS point
    WHERE public.ST_X(point.geom) < -180 OR public.ST_X(point.geom) > 180
       OR public.ST_Y(point.geom) < -90 OR public.ST_Y(point.geom) > 90
  );
$$;
