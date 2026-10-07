ALTER TABLE requests DROP CONSTRAINT decision_has_comment;
ALTER TABLE requests ADD CONSTRAINT decision_has_comment CHECK (
  status NOT IN ('APPROVED','REJECTED') OR
  (decision_comment IS NOT NULL AND length(trim(decision_comment)) BETWEEN 3 AND 500)
);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_identity UNIQUE (organization_id, request_id, id);
ALTER TABLE reports ADD CONSTRAINT report_outbox_tenant FOREIGN KEY (organization_id, request_id, outbox_id)
  REFERENCES outbox_events(organization_id, request_id, id);

-- The only runtime path that can remove audit is bounded retention maintenance.
-- No arguments, no dynamic SQL, pinned search_path; only expired demo workspaces.
CREATE FUNCTION public.purge_expired_demo_workspaces() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE workspace_ids uuid[]; org_ids uuid[]; affected integer;
BEGIN
  SELECT array_agg(id) INTO workspace_ids FROM (
    SELECT id FROM public.workspaces WHERE expires_at < now() ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED
  ) expired;
  IF workspace_ids IS NULL THEN RETURN 0; END IF;
  SELECT array_agg(id) INTO org_ids FROM public.organizations WHERE workspace_id = ANY(workspace_ids);
  DELETE FROM public.sessions WHERE workspace_id = ANY(workspace_ids);
  DELETE FROM public.job_attempts WHERE outbox_id IN (SELECT id FROM public.outbox_events WHERE organization_id = ANY(org_ids));
  DELETE FROM public.reports WHERE organization_id = ANY(org_ids);
  DELETE FROM public.outbox_events WHERE organization_id = ANY(org_ids);
  DELETE FROM public.audit_events WHERE organization_id = ANY(org_ids);
  DELETE FROM public.commands WHERE organization_id = ANY(org_ids);
  DELETE FROM public.requests WHERE organization_id = ANY(org_ids);
  DELETE FROM public.members WHERE organization_id = ANY(org_ids);
  DELETE FROM public.organizations WHERE workspace_id = ANY(workspace_ids);
  DELETE FROM public.workspaces WHERE id = ANY(workspace_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;
REVOKE ALL ON FUNCTION public.purge_expired_demo_workspaces() FROM PUBLIC;
