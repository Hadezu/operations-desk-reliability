-- Execute one complete business command in PostgreSQL. This avoids a sequence
-- of edge round trips while preserving the same atomic boundary for Node and
-- Cloudflare. SECURITY INVOKER: this never elevates the runtime database role.
CREATE FUNCTION public.apply_request_command(
  p_org uuid, p_actor uuid, p_operation text, p_request uuid,
  p_key text, p_fingerprint text, p_body jsonb, p_correlation text,
  p_reports boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  actor_role text;
  scope text;
  cmd commands%ROWTYPE;
  item requests%ROWTYPE;
  action text;
  metadata jsonb := '{}'::jsonb;
  payload jsonb;
BEGIN
  SELECT role INTO actor_role FROM members WHERE id=p_actor AND organization_id=p_org;
  IF actor_role IS NULL OR actor_role='OBSERVER' OR
    (p_operation='decision' AND actor_role<>'MANAGER') THEN
    RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='FORBIDDEN';
  END IF;
  IF p_operation NOT IN ('create','edit','submit','decision') OR
    (p_operation<>'create' AND p_request IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='INVALID_COMMAND';
  END IF;
  scope := CASE WHEN p_operation='create' THEN 'create' ELSE p_operation||':'||p_request END;
  INSERT INTO commands (id,organization_id,actor_id,operation,key,fingerprint)
    VALUES(gen_random_uuid(),p_org,p_actor,scope,p_key,p_fingerprint)
    ON CONFLICT (organization_id,actor_id,operation,key) DO NOTHING;
  SELECT * INTO STRICT cmd FROM commands
    WHERE organization_id=p_org AND actor_id=p_actor AND operation=scope AND key=p_key FOR UPDATE;
  IF cmd.fingerprint<>p_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='IDEMPOTENCY_MISMATCH';
  END IF;
  IF cmd.result IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'value',cmd.result); END IF;

  IF p_operation='create' THEN
    PERFORM id FROM organizations WHERE id=p_org FOR UPDATE;
    IF (SELECT count(*) FROM requests WHERE organization_id=p_org)>=100 THEN
      RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='DEMO_LIMIT';
    END IF;
    INSERT INTO requests (id,organization_id,owner_id,title,description,category,amount_cents)
      VALUES (gen_random_uuid(),p_org,p_actor,p_body->>'title',p_body->>'description',p_body->>'category',(p_body->>'amountCents')::int)
      RETURNING * INTO item;
    action := 'REQUEST_CREATED';
  ELSE
    SELECT * INTO item FROM requests WHERE id=p_request AND organization_id=p_org
      AND (actor_role<>'EMPLOYEE' OR owner_id=p_actor);
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='NOT_FOUND'; END IF;
    IF p_operation='decision' THEN
      IF item.owner_id=p_actor THEN RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='SELF_APPROVAL'; END IF;
      IF p_body->>'decision' NOT IN ('APPROVED','REJECTED') THEN
        RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='INVALID_COMMAND';
      END IF;
      UPDATE requests SET status=p_body->>'decision',decision_comment=p_body->>'comment',version=version+1,updated_at=clock_timestamp()
        WHERE id=p_request AND organization_id=p_org AND status='SUBMITTED' AND version=(p_body->>'version')::int
        RETURNING * INTO item;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='VERSION_CONFLICT'; END IF;
      action := 'REQUEST_'||item.status;
      metadata := jsonb_build_object('comment',item.decision_comment);
    ELSE
      IF item.owner_id<>p_actor THEN RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='FORBIDDEN'; END IF;
      IF p_operation='edit' THEN
        UPDATE requests SET title=p_body->>'title',description=p_body->>'description',category=p_body->>'category',
          amount_cents=(p_body->>'amountCents')::int,version=version+1,updated_at=clock_timestamp()
          WHERE id=p_request AND organization_id=p_org AND owner_id=p_actor AND status='DRAFT' AND version=(p_body->>'version')::int
          RETURNING * INTO item;
        action := 'REQUEST_EDITED';
      ELSE
        UPDATE requests SET status='SUBMITTED',version=version+1,updated_at=clock_timestamp()
          WHERE id=p_request AND organization_id=p_org AND owner_id=p_actor AND status='DRAFT' AND version=(p_body->>'version')::int
          RETURNING * INTO item;
        action := 'REQUEST_SUBMITTED';
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0100', MESSAGE='VERSION_CONFLICT'; END IF;
    END IF;
  END IF;

  INSERT INTO audit_events (id,organization_id,actor_id,entity_id,action,correlation_id,metadata)
    VALUES(gen_random_uuid(),p_org,p_actor,item.id,action,p_correlation,metadata);
  IF p_operation='decision' AND item.status='APPROVED' AND p_reports THEN
    INSERT INTO outbox_events (id,organization_id,request_id,correlation_id)
      VALUES(gen_random_uuid(),p_org,item.id,p_correlation);
    INSERT INTO audit_events (id,organization_id,actor_id,entity_id,action,correlation_id)
      VALUES(gen_random_uuid(),p_org,p_actor,item.id,'REPORT_REQUESTED',p_correlation);
  END IF;
  payload := jsonb_build_object(
    'id',item.id,'organizationId',item.organization_id,'ownerId',item.owner_id,
    'title',item.title,'description',item.description,'category',item.category,'amountCents',item.amount_cents,
    'status',item.status,'version',item.version,'decisionComment',item.decision_comment,
    'createdAt',to_char(item.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(item.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  UPDATE commands SET result=payload WHERE id=cmd.id;
  RETURN jsonb_build_object('ok',true,'value',payload);
EXCEPTION WHEN SQLSTATE 'P0100' THEN
  -- PL/pgSQL rolls back this entire block before returning a domain refusal.
  -- Constraint/connection errors propagate and also roll back every write.
  RETURN jsonb_build_object('ok',false,'code',SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.apply_request_command(uuid,uuid,text,uuid,text,text,jsonb,text,boolean) FROM PUBLIC;
