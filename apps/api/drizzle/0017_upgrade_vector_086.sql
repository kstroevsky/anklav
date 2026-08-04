DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector' AND extversion <> '0.8.6') THEN
    ALTER EXTENSION vector UPDATE TO '0.8.6';
  END IF;
END
$$;
