-- JailManagementPage.tsx's intake form has always collected a security
-- classification (minimum/medium/maximum/protective_custody/medical/
-- administrative_segregation) but the column never existed on `inmates`,
-- so POST /inmates silently dropped it — no classification was ever
-- persisted, and the Stats tab's "By Classification" breakdown had
-- nothing to group by.
ALTER TABLE inmates ADD COLUMN classification TEXT;
