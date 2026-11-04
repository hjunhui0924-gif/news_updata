CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Only searchable metadata is materialized; bodies and translations stay out of list scans.
CREATE FUNCTION feed_search_text(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(value->>'title','') || ' ' || coalesce(value->>'repo','') || ' ' ||
    coalesce(value->>'description','') || ' ' || coalesce((
      SELECT string_agg(tag, ' ' ORDER BY ordinal)
      FROM jsonb_array_elements_text(coalesce(value->'tags','[]'::jsonb)) WITH ORDINALITY AS tags(tag, ordinal)
    ),'')
$$;
ALTER TABLE items ADD COLUMN search_text text GENERATED ALWAYS AS (feed_search_text(data)) STORED;
CREATE INDEX items_search_idx ON items USING gin(search_text gin_trgm_ops) WHERE NOT muted;
CREATE INDEX items_visible_feed_idx ON items(user_id,published_at DESC,id DESC) INCLUDE (read,saved) WHERE NOT muted;
