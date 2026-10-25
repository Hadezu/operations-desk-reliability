-- Immutable while a synthetic workspace is live; bounded owner-function cleanup
-- may remove expired sandbox history, matching the existing retention policy.
CREATE OR REPLACE FUNCTION protect_association_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'DELETE' AND EXISTS (
 SELECT 1 FROM public.organizations o JOIN public.workspaces w ON w.id=o.workspace_id
 WHERE o.id=OLD.organization_id AND w.expires_at < now()) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Association history is append-only';
END $$;
CREATE OR REPLACE FUNCTION public.purge_expired_demo_workspaces() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE workspace_ids uuid[]; org_ids uuid[]; affected integer;
BEGIN
  SELECT array_agg(id) INTO workspace_ids FROM (
    SELECT id FROM public.workspaces WHERE expires_at < now() ORDER BY expires_at LIMIT 20 FOR UPDATE SKIP LOCKED
  ) expired;
  IF workspace_ids IS NULL THEN RETURN 0; END IF;
  SELECT array_agg(id) INTO org_ids FROM public.organizations WHERE workspace_id = ANY(workspace_ids);
  DELETE FROM public.association_revisions WHERE organization_id = ANY(org_ids);
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
