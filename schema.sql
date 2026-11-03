-- BeautyMe — schéma PostgreSQL 16 (+ PostGIS, btree_gist)
-- L'intégrité des créneaux est garantie par la base, pas par l'application.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE territory     AS ENUM ('MQ', 'GP', 'GF');
CREATE TYPE booking_mode  AS ENUM ('salon', 'domicile');
CREATE TYPE booking_state AS ENUM ('held', 'confirmed', 'cancelled', 'no_show', 'done');
CREATE TYPE notif_channel AS ENUM ('whatsapp', 'sms', 'email');

CREATE TABLE commune (
  insee       char(5) PRIMARY KEY,
  territory   territory NOT NULL,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  centroid    geography(Point, 4326) NOT NULL
);

CREATE TABLE salon (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  territory    territory NOT NULL,
  commune      char(5) NOT NULL REFERENCES commune,
  category     text NOT NULL,
  address      text NOT NULL,
  geom         geography(Point, 4326) NOT NULL,
  tz           text GENERATED ALWAYS AS (
                 CASE territory WHEN 'GF' THEN 'America/Cayenne'
                                WHEN 'GP' THEN 'America/Guadeloupe'
                                ELSE 'America/Martinique' END) STORED,
  deposit_pct  smallint NOT NULL DEFAULT 0 CHECK (deposit_pct BETWEEN 0 AND 100),
  price_level  smallint NOT NULL CHECK (price_level BETWEEN 1 AND 4),
  rating_avg   numeric(2,1),
  rating_count integer NOT NULL DEFAULT 0,
  published    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salon_geom_gix ON salon USING gist (geom);
CREATE INDEX salon_name_trgm ON salon USING gin (name gin_trgm_ops);

-- Zones desservies à domicile, temps de trajet en minutes
CREATE TABLE salon_home_zone (
  salon_id    uuid REFERENCES salon ON DELETE CASCADE,
  commune     char(5) REFERENCES commune,
  travel_min  smallint NOT NULL CHECK (travel_min > 0),
  PRIMARY KEY (salon_id, commune)
);

CREATE TABLE staff (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id  uuid NOT NULL REFERENCES salon ON DELETE CASCADE,
  name      text NOT NULL,
  home      boolean NOT NULL DEFAULT false,
  active    boolean NOT NULL DEFAULT true
);

CREATE TABLE service (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id     uuid NOT NULL REFERENCES salon ON DELETE CASCADE,
  section      text NOT NULL,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  duration_min smallint NOT NULL CHECK (duration_min > 0 AND duration_min % 15 = 0),
  pose_offset  smallint,
  pose_len     smallint,
  price_cents  integer,
  price_from   boolean NOT NULL DEFAULT false,
  home_ok      boolean NOT NULL DEFAULT false,
  online       boolean NOT NULL DEFAULT true,
  position     smallint NOT NULL DEFAULT 0,
  CHECK ((pose_offset IS NULL) = (pose_len IS NULL)),
  CHECK (pose_offset IS NULL OR pose_offset + pose_len < duration_min)
);

CREATE TABLE staff_service (
  staff_id    uuid REFERENCES staff ON DELETE CASCADE,
  service_id  uuid REFERENCES service ON DELETE CASCADE,
  price_cents integer,              -- tarif spécifique au niveau du collaborateur
  PRIMARY KEY (staff_id, service_id)
);

-- Horaires hebdomadaires, en heure locale du salon
CREATE TABLE working_hours (
  staff_id  uuid REFERENCES staff ON DELETE CASCADE,
  weekday   smallint CHECK (weekday BETWEEN 0 AND 6),
  opens     time NOT NULL,
  closes    time NOT NULL CHECK (closes > opens),
  EXCLUDE USING gist (staff_id WITH =, weekday WITH =, tsrange(('2000-01-01'::date + opens), ('2000-01-01'::date + closes)) WITH &&)
);

CREATE TABLE time_off (
  staff_id  uuid REFERENCES staff ON DELETE CASCADE,
  during    tstzrange NOT NULL,
  reason    text,
  EXCLUDE USING gist (staff_id WITH =, during WITH &&)
);

CREATE TABLE customer (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  phone_e164 text NOT NULL UNIQUE,
  channel    notif_channel NOT NULL DEFAULT 'whatsapp',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE booking (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      uuid NOT NULL REFERENCES salon,
  staff_id      uuid NOT NULL REFERENCES staff,
  customer_id   uuid REFERENCES customer,
  mode          booking_mode NOT NULL DEFAULT 'salon',
  home_commune  char(5) REFERENCES commune,
  home_address  text,
  during        tstzrange NOT NULL,
  state         booking_state NOT NULL DEFAULT 'held',
  hold_expires  timestamptz,
  total_cents   integer NOT NULL,
  deposit_cents integer NOT NULL DEFAULT 0,
  stripe_pi     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (mode = 'salon' OR (home_commune IS NOT NULL)),
  CHECK (state <> 'held' OR hold_expires IS NOT NULL)
);

CREATE TABLE booking_line (
  booking_id  uuid REFERENCES booking ON DELETE CASCADE,
  service_id  uuid REFERENCES service,
  position    smallint NOT NULL,
  price_cents integer NOT NULL,
  PRIMARY KEY (booking_id, position)
);

-- Segments où le collaborateur est mobilisé (temps de pose exclus, trajets inclus).
-- La contrainte rend toute double réservation physiquement impossible.
CREATE TABLE booking_segment (
  booking_id  uuid NOT NULL REFERENCES booking ON DELETE CASCADE,
  staff_id    uuid NOT NULL REFERENCES staff,
  during      tstzrange NOT NULL,
  live        boolean NOT NULL DEFAULT true,   -- false dès annulation / expiration
  CONSTRAINT no_double_booking
    EXCLUDE USING gist (staff_id WITH =, during WITH &&) WHERE (live)
);

-- Index dénormalisé du filtre « Quand » de la recherche, recalculé par worker
CREATE TABLE availability_day (
  salon_id   uuid REFERENCES salon ON DELETE CASCADE,
  day        date,
  mode       booking_mode,
  first_slot timestamptz,
  PRIMARY KEY (salon_id, day, mode)
);

CREATE TABLE review (
  booking_id  uuid PRIMARY KEY REFERENCES booking,   -- avis vérifié : un RDV honoré = un avis
  welcome     smallint CHECK (welcome BETWEEN 1 AND 5),
  cleanliness smallint CHECK (cleanliness BETWEEN 1 AND 5),
  setting     smallint CHECK (setting BETWEEN 1 AND 5),
  quality     smallint CHECK (quality BETWEEN 1 AND 5),
  body        text,
  reply       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Expiration des holds (appelée par le worker toutes les minutes)
CREATE OR REPLACE FUNCTION expire_holds() RETURNS integer LANGUAGE sql AS $$
  WITH x AS (
    UPDATE booking SET state = 'cancelled'
     WHERE state = 'held' AND hold_expires < now() RETURNING id),
  y AS (
    UPDATE booking_segment SET live = false WHERE booking_id IN (SELECT id FROM x) RETURNING 1)
  SELECT count(*)::int FROM x;
$$;

-- ═══ Espace partenaire ═══════════════════════════════════════════════════
CREATE TYPE application_state AS ENUM ('brouillon', 'en_revue', 'valide', 'refuse');

CREATE TABLE provider_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE,
  password_hash text,                       -- scrypt$sel$empreinte
  phone_e164    text UNIQUE CHECK (phone_e164 ~ '^\+(596|590|594|33)\d{9}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CHECK ((email IS NULL) = (password_hash IS NULL) OR phone_e164 IS NOT NULL)
);

CREATE TABLE provider_session (
  token_mac   char(64) PRIMARY KEY,         -- HMAC du jeton, jamais le jeton
  account_id  uuid NOT NULL REFERENCES provider_account ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE provider_otp (
  phone_e164  text PRIMARY KEY,
  code_mac    char(64) NOT NULL,
  expires_at  timestamptz NOT NULL,
  sent_at     timestamptz NOT NULL,
  attempts_left smallint NOT NULL DEFAULT 5
);

CREATE TABLE salon_application (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL UNIQUE REFERENCES provider_account ON DELETE CASCADE,
  state         application_state NOT NULL DEFAULT 'brouillon',
  draft         jsonb NOT NULL DEFAULT '{}',  -- activité, fiche, prestations, équipe, zones
  siret         char(14) CHECK (siret ~ '^\d{14}$'),
  rc_pro_until  date,
  reason        text,                         -- motif de refus, visible du prestataire
  salon_id      uuid REFERENCES salon,        -- renseigné à la validation
  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (state <> 'refuse' OR length(reason) >= 10),
  CHECK (state <> 'valide' OR salon_id IS NOT NULL)
);
CREATE INDEX salon_application_queue ON salon_application (submitted_at) WHERE state = 'en_revue';

CREATE TABLE provider_document (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES salon_application ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('rc_pro', 'diplome', 'kbis')),
  storage_key    text NOT NULL,              -- objet S3 chiffré, jamais servi publiquement
  original_name  text NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE salon ADD COLUMN owner_id uuid REFERENCES provider_account;
ALTER TABLE salon ADD COLUMN secondary_categories text[] NOT NULL DEFAULT '{}';

-- ═══ Administration ═════════════════════════════════════════════════════
ALTER TABLE salon ADD COLUMN active boolean NOT NULL DEFAULT true;          -- false : masqué, non réservable
ALTER TABLE salon ADD COLUMN deactivated_reason text;
ALTER TABLE provider_account ADD COLUMN active boolean NOT NULL DEFAULT true; -- false : connexion refusée
CREATE INDEX salon_live ON salon (territory, category) WHERE active AND published;

CREATE TABLE site_content (                     -- textes et images éditables des pages
  key        text PRIMARY KEY,
  value      text NOT NULL,                     -- texte, ou clé d'objet S3 pour une image
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

CREATE TABLE service_template (                 -- prestations types proposées à l'inscription
  category     text NOT NULL,
  id           text NOT NULL,
  name         text NOT NULL,
  section      text NOT NULL,
  duration_min smallint NOT NULL CHECK (duration_min > 0 AND duration_min % 15 = 0),
  price_cents  integer,
  price_from   boolean NOT NULL DEFAULT false,
  pose_offset  smallint, pose_len smallint,
  home_ok      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (category, id)
);

CREATE TABLE admin_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  by      text NOT NULL,
  action  text NOT NULL,
  detail  text NOT NULL
);
