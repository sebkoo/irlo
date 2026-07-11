CREATE TYPE "public"."admission_event_type" AS ENUM('submit', 'auto_triage', 'review_open', 'queue_advanced', 'decision_accept', 'decision_reject', 'decision_defer', 'skip_consumed', 'onboarding_complete', 'withdraw');--> statement-breakpoint
CREATE TYPE "public"."application_lane" AS ENUM('standard', 'priority');--> statement-breakpoint
CREATE TYPE "public"."application_state" AS ENUM('draft', 'submitted', 'under_review', 'waitlisted', 'accepted', 'member', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('credit', 'debit', 'grant', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."payment_event_disposition" AS ENUM('applied', 'duplicate', 'superseded', 'no_op_terminal');--> statement-breakpoint
CREATE TYPE "public"."subscription_provider" AS ENUM('apple', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."subscription_state" AS ENUM('trial', 'active', 'grace', 'billing_retry', 'expired', 'refunded');--> statement-breakpoint
CREATE TABLE "admission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"event" "admission_event_type" NOT NULL,
	"actor" text NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"crew_id" uuid NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"state" "application_state" NOT NULL,
	"lane" "application_lane",
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumable_balances" (
	"member_id" uuid NOT NULL,
	"credit_type" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consumable_balances_member_id_credit_type_pk" PRIMARY KEY("member_id","credit_type")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"entry_type" "ledger_entry_type" NOT NULL,
	"credit_type" text NOT NULL,
	"product_id" text,
	"quantity" integer,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"natural_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_natural_key_unique" UNIQUE("natural_key")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text,
	"payload" jsonb NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"inbox_seq" bigserial,
	"disposition" "payment_event_disposition" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_source_event_id_key" UNIQUE("source","event_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "subscription_provider" NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"state" "subscription_state" NOT NULL,
	"product_id" text NOT NULL,
	"will_renew" boolean DEFAULT true NOT NULL,
	"current_period_end" timestamp with time zone,
	"high_water" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_provider_sub_id_generation_key" UNIQUE("provider","provider_subscription_id","generation")
);
--> statement-breakpoint
ALTER TABLE "admission_events" ADD CONSTRAINT "admission_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumable_balances" ADD CONSTRAINT "consumable_balances_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_live_member_crew_key" ON "applications" USING btree ("member_id","crew_id") WHERE "applications"."state" not in ('member', 'rejected', 'withdrawn');