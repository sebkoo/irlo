CREATE TABLE "rail_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"provider" "subscription_provider" NOT NULL,
	"external_id" text NOT NULL,
	"linked_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rail_identities_provider_external_id_key" UNIQUE("provider","external_id")
);
--> statement-breakpoint
ALTER TABLE "rail_identities" ADD CONSTRAINT "rail_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rail_identities_member_id_provider_idx" ON "rail_identities" USING btree ("member_id","provider");