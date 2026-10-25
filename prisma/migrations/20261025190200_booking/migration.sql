CREATE TABLE booking_revisions (LIKE association_revisions INCLUDING ALL);
ALTER TABLE booking_revisions ADD FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE booking_revisions ADD FOREIGN KEY (organization_id,actor_id) REFERENCES members(organization_id,id);
CREATE TRIGGER booking_immutable BEFORE UPDATE OR DELETE ON booking_revisions
FOR EACH ROW EXECUTE FUNCTION protect_association_history();
