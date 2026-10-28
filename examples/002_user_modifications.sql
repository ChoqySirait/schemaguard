-- 002_user_modifications.sql: Berkas DDL bermasalah yang mengakuisisi AccessExclusiveLock & ShareLock
-- 1. DROP COLUMN: Memerlukan AccessExclusiveLock dan berisiko merusak aplikasi versi aktif
ALTER TABLE users DROP COLUMN avatar_url;

-- 2. ALTER COLUMN TYPE: Memerlukan AccessExclusiveLock penuh dan pemindaian ulang tabel (table rewrite)
ALTER TABLE users ALTER COLUMN age TYPE BIGINT;

-- 3. CREATE INDEX non-concurrently: Memerlukan ShareLock yang menahan kueri penulisan
CREATE INDEX idx_orders_user ON orders (user_id);
