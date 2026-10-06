-- Run manually in the Supabase SQL Editor before deploying the application.
-- This file is not executed by the application or build.
BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_ai_usage (
  usage_date date PRIMARY KEY,
  request_count integer NOT NULL DEFAULT 0
    CHECK (request_count BETWEEN 0 AND 30)
);

ALTER TABLE public.daily_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.daily_ai_usage FROM PUBLIC, anon, authenticated;

-- NULL means the day is full; a date means one slot was claimed for that day.
-- ON CONFLICT locks the day's row and checks the current count atomically.
CREATE OR REPLACE FUNCTION public.claim_daily_ai_request()
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claimed_date date;
BEGIN
  INSERT INTO public.daily_ai_usage AS usage (usage_date, request_count)
  VALUES ((clock_timestamp() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (usage_date) DO UPDATE
    SET request_count = usage.request_count + 1
    WHERE usage.request_count < 30
  RETURNING usage.usage_date INTO claimed_date;

  RETURN claimed_date;
END;
$$;

-- Call exactly once per failed claimed request, using its original claim date.
-- Concurrent releases serialize on the row and cannot make the count negative.
CREATE OR REPLACE FUNCTION public.release_daily_ai_request(p_usage_date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.daily_ai_usage
  SET request_count = request_count - 1
  WHERE usage_date = p_usage_date AND request_count > 0;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_ai_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_daily_ai_request(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_ai_request() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_daily_ai_request(date) TO service_role;

COMMIT;
