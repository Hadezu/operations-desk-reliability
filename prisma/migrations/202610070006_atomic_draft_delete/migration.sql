CREATE FUNCTION public.delete_request_draft(p_org uuid,p_actor uuid,p_id uuid,p_version int,p_correlation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor_role text; item requests%ROWTYPE;
BEGIN
  SELECT role INTO actor_role FROM members WHERE id=p_actor AND organization_id=p_org;
  IF actor_role IS NULL OR actor_role='OBSERVER' THEN RAISE EXCEPTION USING ERRCODE='P0100',MESSAGE='FORBIDDEN'; END IF;
  SELECT * INTO item FROM requests WHERE id=p_id AND organization_id=p_org AND (actor_role<>'EMPLOYEE' OR owner_id=p_actor);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0100',MESSAGE='NOT_FOUND'; END IF;
  IF item.owner_id<>p_actor THEN RAISE EXCEPTION USING ERRCODE='P0100',MESSAGE='FORBIDDEN'; END IF;
  DELETE FROM requests WHERE id=p_id AND organization_id=p_org AND owner_id=p_actor AND status='DRAFT' AND version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0100',MESSAGE='VERSION_CONFLICT'; END IF;
  INSERT INTO audit_events(id,organization_id,actor_id,entity_id,action,correlation_id)
    VALUES(gen_random_uuid(),p_org,p_actor,p_id,'REQUEST_DELETED',p_correlation);
  RETURN jsonb_build_object('ok',true);
EXCEPTION WHEN SQLSTATE 'P0100' THEN
  RETURN jsonb_build_object('ok',false,'code',SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_request_draft(uuid,uuid,uuid,int,text) FROM PUBLIC;
