ALTER TABLE items ADD COLUMN has_sub_unit INTEGER NOT NULL DEFAULT 1 CHECK (has_sub_unit IN (0, 1));
