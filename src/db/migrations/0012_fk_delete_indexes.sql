-- D-891: foreign keys a delete must check had no index on their column (two self-references ON DELETE SET NULL, and
-- submissions.resulting_event_id), so each deleted row scanned the whole referencing table. The archive's first live
-- run (2026-11-23) timed out deleting one batch's field_provenance rows.
CREATE INDEX "events_merged_into_id_idx" ON "events" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "field_provenance_conflicts_with_idx" ON "field_provenance" USING btree ("conflicts_with");--> statement-breakpoint
CREATE INDEX "submissions_resulting_event_id_idx" ON "submissions" USING btree ("resulting_event_id");
