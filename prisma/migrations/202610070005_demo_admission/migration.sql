CREATE FUNCTION public.provision_demo_workspace(p jsonb, daily_limit int)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF daily_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(26100701);
    IF (SELECT count(*) FROM workspaces WHERE created_at >=
      (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) >= daily_limit THEN
      RETURN false;
    END IF;
  END IF;
  WITH w AS (
    INSERT INTO workspaces(id,expires_at) VALUES((p->>'workspaceId')::uuid,(p->>'workspaceExpiry')::timestamptz) RETURNING id
  ), o AS (
    INSERT INTO organizations(id,workspace_id,name)
    SELECT x.id,w.id,x.name FROM w,jsonb_to_recordset(p->'organizations') AS x(id uuid,name text) RETURNING id
  ), m AS (
    INSERT INTO members(id,organization_id,name,role)
    SELECT x.id,o.id,x.name,x.role FROM o JOIN jsonb_to_recordset(p->'members')
      AS x(id uuid,organization_id uuid,name text,role text) ON x.organization_id=o.id RETURNING id,organization_id
  ), r AS (
    INSERT INTO requests(id,organization_id,owner_id,title,description,category,amount_cents,status)
    SELECT x.id,m.organization_id,m.id,x.title,'Synthetic demo request. Explore the workflow using your private workspace.',x.category,x.amount_cents,x.status
    FROM m JOIN jsonb_to_recordset(p->'requests')
      AS x(id uuid,organization_id uuid,owner_id uuid,title text,category text,amount_cents int,status text) ON x.owner_id=m.id RETURNING id
  )
  INSERT INTO sessions(token_hash,workspace_id,member_id,csrf_token,expires_at)
  SELECT p->>'tokenHash',w.id,m.id,p->>'csrfToken',(p->>'expiresAt')::timestamptz
    FROM w,m WHERE m.id=(p->>'memberId')::uuid;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.provision_demo_workspace(jsonb,int) FROM PUBLIC;
