CREATE INDEX IF NOT EXISTS idx_memorial_posts_ip_created
ON public.memorial_posts (ip_hash, created_at DESC)
WHERE ip_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_memorial_post_rate_limit(
  p_ip_hash text,
  p_window_s integer DEFAULT 600,
  p_max integer DEFAULT 3,
  p_hourly_max integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_hourly_count integer;
  v_window_count integer;
  v_window_seconds integer := GREATEST(COALESCE(p_window_s, 600), 1);
  v_window_max integer := GREATEST(COALESCE(p_max, 3), 1);
  v_hourly_maximum integer := GREATEST(COALESCE(p_hourly_max, 5), 1);
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) < 16 OR length(p_ip_hash) > 128 THEN
    RETURN false;
  END IF;

  SELECT count(*)::integer
    INTO v_hourly_count
    FROM public.memorial_posts
   WHERE ip_hash = p_ip_hash
     AND created_at >= now() - interval '1 hour';

  IF v_hourly_count >= v_hourly_maximum THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_windows (ip_hash, window_start, count)
  VALUES (p_ip_hash, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE
    SET window_start = CASE
          WHEN public.rate_limit_windows.window_start <= now() - make_interval(secs => v_window_seconds)
            THEN now()
          ELSE public.rate_limit_windows.window_start
        END,
        count = CASE
          WHEN public.rate_limit_windows.window_start <= now() - make_interval(secs => v_window_seconds)
            THEN 1
          ELSE public.rate_limit_windows.count + 1
        END
  RETURNING count INTO v_window_count;

  RETURN v_window_count <= v_window_max;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_memorial_post_rate_limit(text, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_memorial_post_rate_limit(text, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_memorial_post_rate_limit(text, integer, integer, integer) TO service_role;
