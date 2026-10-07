-- These database invariants are intentionally explicit SQL, not only ORM types.
ALTER TABLE members ADD CONSTRAINT member_role CHECK (role IN ('EMPLOYEE','MANAGER','OBSERVER'));
ALTER TABLE requests ADD CONSTRAINT request_status CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED'));
ALTER TABLE requests ADD CONSTRAINT request_category CHECK (category IN ('EQUIPMENT','SOFTWARE','TRAVEL'));
ALTER TABLE requests ADD CONSTRAINT positive_amount CHECK (amount_cents BETWEEN 1 AND 10000000);
ALTER TABLE requests ADD CONSTRAINT positive_version CHECK (version > 0);
ALTER TABLE requests ADD CONSTRAINT request_title CHECK (length(title) BETWEEN 3 AND 100);
ALTER TABLE requests ADD CONSTRAINT decision_has_comment CHECK (status NOT IN ('APPROVED','REJECTED') OR length(trim(decision_comment)) >= 3);
ALTER TABLE requests ADD CONSTRAINT request_owner_tenant FOREIGN KEY (organization_id, owner_id) REFERENCES members(organization_id,id);
ALTER TABLE sessions ADD CONSTRAINT session_member FOREIGN KEY (member_id) REFERENCES members(id);
ALTER TABLE audit_events ADD CONSTRAINT audit_actor_tenant FOREIGN KEY (organization_id,actor_id) REFERENCES members(organization_id,id);
ALTER TABLE audit_events ADD CONSTRAINT audit_tenant FOREIGN KEY (organization_id) REFERENCES organizations(id);
-- entity_id deliberately survives deletion of a draft; audit history is retained.
ALTER TABLE commands ADD CONSTRAINT command_actor_tenant FOREIGN KEY (organization_id,actor_id) REFERENCES members(organization_id,id);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_request_tenant FOREIGN KEY (organization_id,request_id) REFERENCES requests(organization_id,id);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_status CHECK (status IN ('PENDING','DISPATCHING','PUBLISHED','COMPLETED','FAILED'));
ALTER TABLE reports ADD CONSTRAINT report_request_tenant FOREIGN KEY (organization_id,request_id) REFERENCES requests(organization_id,id);
ALTER TABLE reports ADD CONSTRAINT report_event FOREIGN KEY (outbox_id) REFERENCES outbox_events(id);
ALTER TABLE job_attempts ADD CONSTRAINT attempt_event FOREIGN KEY (outbox_id) REFERENCES outbox_events(id);
ALTER TABLE job_attempts ADD CONSTRAINT attempt_status CHECK (status IN ('RUNNING','COMPLETED','FAILED','INTERRUPTED'));
CREATE INDEX requests_owner ON requests(organization_id,owner_id,created_at DESC,id DESC);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- Runtime privileges are applied separately by scripts/provision-role.ts.
-- Managed providers may not grant CREATE ROLE to migration users. Deployment is
-- not verified until the restricted role and audit write-denial test pass there.
