CREATE TABLE association_revisions (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  revision integer NOT NULL CHECK (revision > 0),
  actor_id uuid NOT NULL,
  operation text NOT NULL,
  command_key text NOT NULL,
  fingerprint text NOT NULL,
  state jsonb NOT NULL,
  outcome jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, revision),
  UNIQUE (organization_id, actor_id, command_key),
  FOREIGN KEY (organization_id, actor_id) REFERENCES members(organization_id,id)
);
CREATE FUNCTION protect_association_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Association history is append-only';
END $$;
CREATE TRIGGER association_immutable BEFORE UPDATE OR DELETE ON association_revisions
FOR EACH ROW EXECUTE FUNCTION protect_association_history();
