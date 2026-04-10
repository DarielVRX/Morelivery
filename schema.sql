--
-- PostgreSQL database dump
--

\restrict VFoKvnzVpYkkPHcpgijZoPwbl6Cf6SOjVAwP3UBogTaSbMZzcvo3MdVLHoyTG7p

-- Dumped from database version 17.9 (Debian 17.9-1.pgdg13+1)
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: account_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.account_status AS ENUM (
    'active',
    'suspended'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'customer',
    'restaurant',
    'driver',
    'admin'
);


--
-- Name: set_accepted_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_accepted_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = 'assigned' AND OLD.status != 'assigned' AND NEW.accepted_at IS NULL THEN
    NEW.accepted_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: blocked_fingerprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocked_fingerprints (
    fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: driver_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_profiles (
    user_id uuid NOT NULL,
    driver_number bigint NOT NULL,
    vehicle_type character varying(50),
    is_verified boolean DEFAULT false NOT NULL,
    is_available boolean DEFAULT false NOT NULL,
    last_lat numeric(9,6),
    last_lng numeric(9,6),
    created_at timestamp with time zone DEFAULT now(),
    disconnect_penalties integer DEFAULT 0 NOT NULL,
    bag_capacity_liters numeric(6,2) DEFAULT 25 NOT NULL,
    total_rebalances integer DEFAULT 0 NOT NULL,
    total_releases integer DEFAULT 0 NOT NULL,
    total_cancels integer DEFAULT 0 NOT NULL,
    total_expires integer DEFAULT 0 NOT NULL,
    session_rebalances integer DEFAULT 0 NOT NULL,
    session_releases integer DEFAULT 0 NOT NULL,
    session_cancels integer DEFAULT 0 NOT NULL,
    session_expires integer DEFAULT 0 NOT NULL,
    session_started_at timestamp with time zone,
    rating_avg numeric(3,2) DEFAULT NULL::numeric,
    rating_count integer DEFAULT 0,
    active_orders_count integer DEFAULT 0 NOT NULL
);


--
-- Name: driver_profiles_driver_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.driver_profiles_driver_number_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: driver_profiles_driver_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.driver_profiles_driver_number_seq OWNED BY public.driver_profiles.driver_number;


--
-- Name: engine_params; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engine_params (
    key character varying(80) NOT NULL,
    value double precision NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: impassable_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impassable_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    way_id character varying(30) NOT NULL,
    confirmed_by uuid NOT NULL,
    estimated_duration character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT impassable_confirmations_estimated_duration_check CHECK (((estimated_duration)::text = ANY (ARRAY[('days'::character varying)::text, ('weeks'::character varying)::text, ('months'::character varying)::text, ('permanent'::character varying)::text])))
);


--
-- Name: impassable_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impassable_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    way_id character varying(30) NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    description text,
    estimated_duration character varying(20) NOT NULL,
    confirmed boolean DEFAULT false NOT NULL,
    consensus_duration character varying(20),
    reported_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    coords jsonb,
    name text,
    way_ids text[],
    CONSTRAINT impassable_reports_estimated_duration_check CHECK (((estimated_duration)::text = ANY (ARRAY[('days'::character varying)::text, ('weeks'::character varying)::text, ('months'::character varying)::text, ('permanent'::character varying)::text])))
);


--
-- Name: impassable_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impassable_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    way_id character varying NOT NULL,
    driver_id uuid NOT NULL,
    vote character varying(10) NOT NULL,
    voted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT impassable_votes_vote_check CHECK (((vote)::text = ANY ((ARRAY['confirm'::character varying, 'dismiss'::character varying])::text[])))
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    id integer NOT NULL,
    email text NOT NULL,
    fingerprint text,
    attempts integer DEFAULT 1 NOT NULL,
    locked_until timestamp with time zone,
    last_attempt timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: login_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_attempts_id_seq OWNED BY public.login_attempts.id;


--
-- Name: menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    name character varying(140) NOT NULL,
    description text,
    price_cents integer NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    image_url text,
    pkg_units smallint DEFAULT 1 NOT NULL,
    pkg_volume_liters numeric(6,3) DEFAULT 0 NOT NULL
);


--
-- Name: order_complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_complaints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: order_driver_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_driver_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    wait_until timestamp with time zone,
    bag_overflow_pct smallint DEFAULT 0 NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    menu_item_id uuid,
    quantity integer NOT NULL,
    unit_price_cents integer NOT NULL
);


--
-- Name: order_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_messages_text_check CHECK ((char_length(text) <= 500))
);


--
-- Name: order_ratings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    driver_id uuid,
    restaurant_stars smallint NOT NULL,
    driver_stars smallint,
    comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    restaurant_rates_driver smallint,
    driver_rates_restaurant smallint,
    driver_comment text,
    restaurant_comment text,
    CONSTRAINT order_ratings_driver_rates_restaurant_check CHECK (((driver_rates_restaurant >= 1) AND (driver_rates_restaurant <= 5))),
    CONSTRAINT order_ratings_driver_stars_check CHECK (((driver_stars >= 1) AND (driver_stars <= 5))),
    CONSTRAINT order_ratings_restaurant_rates_driver_check CHECK (((restaurant_rates_driver >= 1) AND (restaurant_rates_driver <= 5))),
    CONSTRAINT order_ratings_restaurant_stars_check CHECK (((restaurant_stars >= 1) AND (restaurant_stars <= 5)))
);


--
-- Name: order_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    reporter_role character varying(20) NOT NULL,
    reason character varying(80) DEFAULT 'general'::character varying NOT NULL,
    text text NOT NULL,
    reviewed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    driver_id uuid,
    status character varying(30) NOT NULL,
    total_cents integer NOT NULL,
    delivery_address text NOT NULL,
    suggestion_text text,
    suggestion_status character varying(20) DEFAULT 'none'::character varying NOT NULL,
    driver_note text,
    restaurant_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    restaurant_lat numeric(9,6),
    restaurant_lng numeric(9,6),
    delivery_lat numeric(9,6),
    delivery_lng numeric(9,6),
    accepted_at timestamp with time zone,
    preparing_at timestamp with time zone,
    ready_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    offer_cooldown_triggered boolean DEFAULT false NOT NULL,
    service_fee_cents integer DEFAULT 0 NOT NULL,
    delivery_fee_cents integer DEFAULT 0 NOT NULL,
    tip_cents integer DEFAULT 0 NOT NULL,
    payment_method text DEFAULT 'cash'::text NOT NULL,
    restaurant_fee_cents integer DEFAULT 0 NOT NULL,
    delivered_tip_cents integer DEFAULT 0 NOT NULL,
    last_driver_id uuid,
    reconnect_deadline timestamp with time zone,
    prep_started_at timestamp with time zone,
    kitchen_estimated_ready timestamp with time zone,
    pickup_wait_s integer DEFAULT 0 NOT NULL,
    last_transferred_at timestamp with time zone,
    assignment_score double precision,
    route_distance_km double precision,
    estimated_volume_liters numeric(8,3) DEFAULT 0 NOT NULL,
    is_disputed boolean DEFAULT false NOT NULL,
    disputed_until timestamp with time zone,
    disputed_by uuid,
    chat_reopened_at timestamp with time zone,
    dispute_cancelled_by_driver boolean DEFAULT false,
    restaurant_confirmed boolean DEFAULT false NOT NULL,
    restaurant_confirmed_at timestamp with time zone,
    driver_search_escalated_at timestamp with time zone,
    driver_search_push_sent_at timestamp with time zone,
    driver_search_last_notified_at timestamp with time zone,
    sla_delay_push_sent_at timestamp with time zone,
    sla_delay_accepted_at timestamp with time zone,
    sla_delay_seconds integer,
    CONSTRAINT orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'card'::text, 'spei'::text])))
);


--
-- Name: payment_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    user_id uuid NOT NULL,
    provider text DEFAULT 'stripe'::text NOT NULL,
    provider_intent_id text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'mxn'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    client_secret text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id integer NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    keys jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: push_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.push_subscriptions_id_seq OWNED BY public.push_subscriptions.id;


--
-- Name: restaurant_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    day_of_week smallint NOT NULL,
    opens_at time without time zone,
    closes_at time without time zone,
    is_closed boolean DEFAULT false NOT NULL,
    CONSTRAINT restaurant_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: restaurants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id uuid NOT NULL,
    name character varying(140) NOT NULL,
    category character varying(80) NOT NULL,
    address text,
    is_open boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lat numeric(9,6),
    lng numeric(9,6),
    manual_open_override boolean,
    profile_photo text,
    postal_code text,
    colonia text,
    estado text,
    ciudad text,
    home_lat double precision,
    home_lng double precision,
    rating_avg numeric(3,2) DEFAULT NULL::numeric,
    rating_count integer DEFAULT 0,
    prep_time_estimate_s integer DEFAULT 600 NOT NULL,
    last_prep_time_s integer,
    prep_estimate_updated_at timestamp with time zone,
    cover_photo text,
    max_cash_cents integer DEFAULT 0 NOT NULL,
    allow_frequent_customers boolean DEFAULT false NOT NULL
);


--
-- Name: road_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.road_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    way_id character varying(30) NOT NULL,
    preference character varying(20) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT road_preferences_preference_check CHECK (((preference)::text = ANY (ARRAY[('preferred'::character varying)::text, ('difficult'::character varying)::text, ('avoid'::character varying)::text])))
);


--
-- Name: road_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.road_zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    radius_m integer DEFAULT 100 NOT NULL,
    type character varying(20) NOT NULL,
    estimated_hours integer NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed boolean DEFAULT false
);


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    text text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_text_check CHECK ((char_length(text) <= 1000))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subject text NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    CONSTRAINT support_tickets_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'pending'::character varying, 'resolved'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: test_dariel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_dariel (
    id integer NOT NULL
);


--
-- Name: test_dariel_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_dariel_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_dariel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_dariel_id_seq OWNED BY public.test_dariel.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name character varying(120) NOT NULL,
    email character varying(150) NOT NULL,
    password_hash text NOT NULL,
    role public.user_role NOT NULL,
    status public.account_status DEFAULT 'active'::public.account_status NOT NULL,
    address text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lat numeric(9,6),
    lng numeric(9,6),
    alias text,
    postal_code text,
    colonia text,
    estado text,
    ciudad text,
    home_lat double precision,
    home_lng double precision,
    real_email text,
    google_id text,
    calle text,
    numero text,
    email_verified boolean DEFAULT false NOT NULL,
    email_verify_token text,
    email_verify_expires timestamp with time zone,
    orders_blocked boolean DEFAULT false NOT NULL,
    orders_blocked_reason text,
    account_locked boolean DEFAULT false NOT NULL,
    account_unlock_token text,
    account_unlock_expires timestamp with time zone,
    two_fa_enabled boolean DEFAULT false NOT NULL,
    two_fa_code text,
    two_fa_expires timestamp with time zone
);


--
-- Name: zone_pending_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zone_pending_edits (
    zone_id uuid NOT NULL,
    type character varying(20),
    estimated_hours integer,
    suggested_by uuid,
    confirm_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: zone_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zone_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    zone_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    vote character varying(10) NOT NULL,
    voted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT zone_votes_vote_check CHECK (((vote)::text = ANY ((ARRAY['confirm'::character varying, 'dismiss'::character varying])::text[])))
);


--
-- Name: driver_profiles driver_number; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles ALTER COLUMN driver_number SET DEFAULT nextval('public.driver_profiles_driver_number_seq'::regclass);


--
-- Name: login_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts ALTER COLUMN id SET DEFAULT nextval('public.login_attempts_id_seq'::regclass);


--
-- Name: push_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.push_subscriptions_id_seq'::regclass);


--
-- Name: test_dariel id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_dariel ALTER COLUMN id SET DEFAULT nextval('public.test_dariel_id_seq'::regclass);


--
-- Name: blocked_fingerprints blocked_fingerprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocked_fingerprints
    ADD CONSTRAINT blocked_fingerprints_pkey PRIMARY KEY (fingerprint);


--
-- Name: driver_profiles driver_profiles_driver_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_driver_number_key UNIQUE (driver_number);


--
-- Name: driver_profiles driver_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: engine_params engine_params_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engine_params
    ADD CONSTRAINT engine_params_pkey PRIMARY KEY (key);


--
-- Name: impassable_confirmations impassable_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_confirmations
    ADD CONSTRAINT impassable_confirmations_pkey PRIMARY KEY (id);


--
-- Name: impassable_confirmations impassable_confirmations_way_id_confirmed_by_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_confirmations
    ADD CONSTRAINT impassable_confirmations_way_id_confirmed_by_key UNIQUE (way_id, confirmed_by);


--
-- Name: impassable_reports impassable_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_reports
    ADD CONSTRAINT impassable_reports_pkey PRIMARY KEY (id);


--
-- Name: impassable_reports impassable_reports_way_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_reports
    ADD CONSTRAINT impassable_reports_way_id_unique UNIQUE (way_id);


--
-- Name: impassable_votes impassable_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_votes
    ADD CONSTRAINT impassable_votes_pkey PRIMARY KEY (id);


--
-- Name: impassable_votes impassable_votes_way_id_driver_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_votes
    ADD CONSTRAINT impassable_votes_way_id_driver_id_key UNIQUE (way_id, driver_id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: menu_items menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);


--
-- Name: order_complaints order_complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_complaints
    ADD CONSTRAINT order_complaints_pkey PRIMARY KEY (id);


--
-- Name: order_driver_offers order_driver_offers_order_id_driver_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_driver_offers
    ADD CONSTRAINT order_driver_offers_order_id_driver_id_key UNIQUE (order_id, driver_id);


--
-- Name: order_driver_offers order_driver_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_driver_offers
    ADD CONSTRAINT order_driver_offers_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_messages order_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_messages
    ADD CONSTRAINT order_messages_pkey PRIMARY KEY (id);


--
-- Name: order_ratings order_ratings_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_ratings
    ADD CONSTRAINT order_ratings_order_id_key UNIQUE (order_id);


--
-- Name: order_ratings order_ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_ratings
    ADD CONSTRAINT order_ratings_pkey PRIMARY KEY (id);


--
-- Name: order_reports order_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reports
    ADD CONSTRAINT order_reports_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: payment_intents payment_intents_provider_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_provider_intent_id_key UNIQUE (provider_intent_id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: restaurant_schedules restaurant_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_schedules
    ADD CONSTRAINT restaurant_schedules_pkey PRIMARY KEY (id);


--
-- Name: restaurant_schedules restaurant_schedules_restaurant_id_day_of_week_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_schedules
    ADD CONSTRAINT restaurant_schedules_restaurant_id_day_of_week_key UNIQUE (restaurant_id, day_of_week);


--
-- Name: restaurants restaurants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);


--
-- Name: road_preferences road_preferences_driver_id_way_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.road_preferences
    ADD CONSTRAINT road_preferences_driver_id_way_id_key UNIQUE (driver_id, way_id);


--
-- Name: road_preferences road_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.road_preferences
    ADD CONSTRAINT road_preferences_pkey PRIMARY KEY (id);


--
-- Name: road_zones road_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.road_zones
    ADD CONSTRAINT road_zones_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: test_dariel test_dariel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_dariel
    ADD CONSTRAINT test_dariel_pkey PRIMARY KEY (id);


--
-- Name: users users_email_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_role_key UNIQUE (email, role);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: zone_pending_edits zone_pending_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_pending_edits
    ADD CONSTRAINT zone_pending_edits_pkey PRIMARY KEY (zone_id);


--
-- Name: zone_votes zone_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_votes
    ADD CONSTRAINT zone_votes_pkey PRIMARY KEY (id);


--
-- Name: zone_votes zone_votes_zone_id_driver_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_votes
    ADD CONSTRAINT zone_votes_zone_id_driver_id_key UNIQUE (zone_id, driver_id);


--
-- Name: idx_impassable_one_per_way; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_impassable_one_per_way ON public.impassable_reports USING btree (way_id) WHERE (confirmed = false);


--
-- Name: idx_impassable_votes_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impassable_votes_driver ON public.impassable_votes USING btree (driver_id);


--
-- Name: idx_impassable_votes_way; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impassable_votes_way ON public.impassable_votes USING btree (way_id);


--
-- Name: idx_impassable_way; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impassable_way ON public.impassable_reports USING btree (way_id);


--
-- Name: idx_login_attempts_email_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_email_fp ON public.login_attempts USING btree (email, fingerprint);


--
-- Name: idx_messages_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_order ON public.order_messages USING btree (order_id, created_at);


--
-- Name: idx_offers_driver_pending_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_driver_pending_status ON public.order_driver_offers USING btree (driver_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_offers_order_driver_cooldown; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_order_driver_cooldown ON public.order_driver_offers USING btree (order_id, driver_id, wait_until) WHERE ((status)::text = ANY ((ARRAY['rejected'::character varying, 'released'::character varying, 'expired'::character varying])::text[]));


--
-- Name: idx_offers_order_pending_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_order_pending_status ON public.order_driver_offers USING btree (order_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_offers_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_order_status ON public.order_driver_offers USING btree (order_id, status);


--
-- Name: idx_offers_order_wait; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_order_wait ON public.order_driver_offers USING btree (order_id, wait_until) WHERE ((status)::text = ANY (ARRAY[('rejected'::character varying)::text, ('expired'::character varying)::text, ('released'::character varying)::text]));


--
-- Name: idx_offers_wait; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_offers_wait ON public.order_driver_offers USING btree (driver_id, wait_until) WHERE (wait_until IS NOT NULL);


--
-- Name: idx_order_driver_offers_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_driver_offers_driver ON public.order_driver_offers USING btree (driver_id);


--
-- Name: idx_order_driver_offers_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_driver_offers_order ON public.order_driver_offers USING btree (order_id);


--
-- Name: idx_orders_assignment_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_assignment_queue ON public.orders USING btree (created_at) WHERE ((driver_id IS NULL) AND ((status)::text <> ALL ((ARRAY['delivered'::character varying, 'cancelled'::character varying])::text[])));


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at);


--
-- Name: idx_orders_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer ON public.orders USING btree (customer_id);


--
-- Name: idx_orders_disputed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_disputed ON public.orders USING btree (disputed_until) WHERE (is_disputed = true);


--
-- Name: idx_orders_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_driver ON public.orders USING btree (driver_id);


--
-- Name: idx_orders_driver_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_driver_id ON public.orders USING btree (driver_id) WHERE (driver_id IS NOT NULL);


--
-- Name: idx_orders_driver_status_active_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_driver_status_active_count ON public.orders USING btree (driver_id, status) WHERE ((status)::text = ANY ((ARRAY['assigned'::character varying, 'accepted'::character varying, 'preparing'::character varying, 'ready'::character varying, 'on_the_way'::character varying])::text[]));


--
-- Name: idx_orders_kitchen_ready; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_kitchen_ready ON public.orders USING btree (kitchen_estimated_ready) WHERE (kitchen_estimated_ready IS NOT NULL);


--
-- Name: idx_orders_last_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_last_driver ON public.orders USING btree (last_driver_id) WHERE (last_driver_id IS NOT NULL);


--
-- Name: idx_orders_reconnect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_reconnect ON public.orders USING btree (reconnect_deadline) WHERE (reconnect_deadline IS NOT NULL);


--
-- Name: idx_orders_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_restaurant ON public.orders USING btree (restaurant_id);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_status_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status_active ON public.orders USING btree (status) WHERE ((status)::text <> ALL (ARRAY[('delivered'::character varying)::text, ('cancelled'::character varying)::text]));


--
-- Name: idx_payment_intents_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_intents_order_id ON public.payment_intents USING btree (order_id);


--
-- Name: idx_payment_intents_provider_intent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_intents_provider_intent_id ON public.payment_intents USING btree (provider_intent_id);


--
-- Name: idx_payment_intents_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_intents_user_id ON public.payment_intents USING btree (user_id);


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_ratings_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_customer ON public.order_ratings USING btree (customer_id);


--
-- Name: idx_ratings_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_driver ON public.order_ratings USING btree (driver_id);


--
-- Name: idx_ratings_restaurant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ratings_restaurant ON public.order_ratings USING btree (restaurant_id);


--
-- Name: idx_reports_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_order ON public.order_reports USING btree (order_id);


--
-- Name: idx_reports_unreviewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reports_unreviewed ON public.order_reports USING btree (reviewed) WHERE (reviewed = false);


--
-- Name: idx_restaurant_sched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_sched ON public.restaurant_schedules USING btree (restaurant_id, day_of_week);


--
-- Name: idx_road_zones_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_road_zones_expires ON public.road_zones USING btree (expires_at) WHERE (active = true);


--
-- Name: idx_support_messages_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_ticket ON public.support_messages USING btree (ticket_id, created_at);


--
-- Name: idx_support_tickets_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_open ON public.support_tickets USING btree (status) WHERE ((status)::text = ANY ((ARRAY['open'::character varying, 'pending'::character varying])::text[]));


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_support_tickets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_user ON public.support_tickets USING btree (user_id);


--
-- Name: idx_users_email_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email_role ON public.users USING btree (email, role);


--
-- Name: idx_zone_votes_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zone_votes_zone ON public.zone_votes USING btree (zone_id);


--
-- Name: users_google_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_google_id_idx ON public.users USING btree (google_id) WHERE (google_id IS NOT NULL);


--
-- Name: users_real_email_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_real_email_role_idx ON public.users USING btree (real_email, role) WHERE (real_email IS NOT NULL);


--
-- Name: orders trg_set_accepted_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_accepted_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_accepted_at();


--
-- Name: driver_profiles driver_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_profiles
    ADD CONSTRAINT driver_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: engine_params engine_params_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engine_params
    ADD CONSTRAINT engine_params_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: impassable_votes fk_impassable_votes_driver; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_votes
    ADD CONSTRAINT fk_impassable_votes_driver FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: impassable_votes fk_impassable_votes_way; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_votes
    ADD CONSTRAINT fk_impassable_votes_way FOREIGN KEY (way_id) REFERENCES public.impassable_reports(way_id) ON DELETE CASCADE;


--
-- Name: impassable_confirmations impassable_confirmations_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_confirmations
    ADD CONSTRAINT impassable_confirmations_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: impassable_reports impassable_reports_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impassable_reports
    ADD CONSTRAINT impassable_reports_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: menu_items menu_items_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.menu_items
    ADD CONSTRAINT menu_items_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: order_complaints order_complaints_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_complaints
    ADD CONSTRAINT order_complaints_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- Name: order_complaints order_complaints_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_complaints
    ADD CONSTRAINT order_complaints_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_driver_offers order_driver_offers_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_driver_offers
    ADD CONSTRAINT order_driver_offers_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id);


--
-- Name: order_driver_offers order_driver_offers_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_driver_offers
    ADD CONSTRAINT order_driver_offers_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_messages order_messages_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_messages
    ADD CONSTRAINT order_messages_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_messages order_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_messages
    ADD CONSTRAINT order_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id);


--
-- Name: order_ratings order_ratings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_ratings
    ADD CONSTRAINT order_ratings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_ratings order_ratings_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_ratings
    ADD CONSTRAINT order_ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: order_ratings order_ratings_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_ratings
    ADD CONSTRAINT order_ratings_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_ratings order_ratings_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_ratings
    ADD CONSTRAINT order_ratings_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: order_reports order_reports_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reports
    ADD CONSTRAINT order_reports_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_reports order_reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_reports
    ADD CONSTRAINT order_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- Name: orders orders_disputed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_disputed_by_fkey FOREIGN KEY (disputed_by) REFERENCES public.users(id);


--
-- Name: orders orders_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id);


--
-- Name: orders orders_last_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_last_driver_id_fkey FOREIGN KEY (last_driver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orders orders_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id);


--
-- Name: payment_intents payment_intents_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: payment_intents payment_intents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_intents
    ADD CONSTRAINT payment_intents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: restaurant_schedules restaurant_schedules_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_schedules
    ADD CONSTRAINT restaurant_schedules_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;


--
-- Name: restaurants restaurants_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id);


--
-- Name: road_preferences road_preferences_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.road_preferences
    ADD CONSTRAINT road_preferences_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: road_zones road_zones_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.road_zones
    ADD CONSTRAINT road_zones_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: support_messages support_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: zone_pending_edits zone_pending_edits_suggested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_pending_edits
    ADD CONSTRAINT zone_pending_edits_suggested_by_fkey FOREIGN KEY (suggested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: zone_pending_edits zone_pending_edits_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_pending_edits
    ADD CONSTRAINT zone_pending_edits_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.road_zones(id) ON DELETE CASCADE;


--
-- Name: zone_votes zone_votes_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_votes
    ADD CONSTRAINT zone_votes_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: zone_votes zone_votes_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zone_votes
    ADD CONSTRAINT zone_votes_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.road_zones(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict VFoKvnzVpYkkPHcpgijZoPwbl6Cf6SOjVAwP3UBogTaSbMZzcvo3MdVLHoyTG7p

