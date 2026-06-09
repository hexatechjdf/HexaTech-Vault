-- 0008_protect_root_folder.sql
-- DB-level guard so the company root folder row can never be soft-deleted.
-- Backstops the code-level fixes in sync-drive: any UPDATE that tries to set
-- deleted_at on an is_root row raises an exception.

drop trigger if exists trg_prevent_root_soft_delete on folders;
drop function if exists prevent_root_soft_delete();

create function prevent_root_soft_delete() returns trigger as $$
begin
  if NEW.is_root = true and NEW.deleted_at is not null then
    raise exception 'Cannot soft-delete the company root folder';
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger trg_prevent_root_soft_delete
before update on folders
for each row execute function prevent_root_soft_delete();
